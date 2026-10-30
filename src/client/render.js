// Draws the simulation with three.js: the bodies, pads with their cue, the dummy and other
// players, shots and blasts, and the weapon in view. It only reads the world; drawing happens between the
// last two ticks (alpha) so motion stays smooth on screens faster than the 60 Hz simulation. What each
// thing looks like lives in look/ (sky, sun, planets, aliens, weapons, props); this file keeps the scene,
// camera, lights and the frame, and moves the pieces to where the world says they are.
import * as THREE from "three";
import { tumble, trailPush, trailFade, rockHeat } from "./rocklook.js";
import { PLAYER, DUMMY, PAD_CUE, TICK, PICKUPS, WEAPONS, FEEDBACK, ROCK_LOOK, LOOK, ASTEROID, COLOURS } from "../tuning.js";
import { padPos } from "../sim/pads.js";
import { pickupReady } from "../sim/pickups.js";
import { posesAt } from "../sim/system.js";
import { surfaceInfo } from "../sim/collide.js";
import { add, sub, scale, lerp, norm, cross, dist, rotateAxis, rotateFromTo } from "../sim/vec.js";
import { rng, v3, Y, haloMap } from "./look/common.js";
import { starfield, nebulaSky, PLAIN_SPACE } from "./look/sky.js";
import { sunLook } from "./look/sun.js";
import { flareLook } from "./look/solarflare.js";
import { flareView } from "./look/flarepose.js";
import { thirdCamera, aimPoint } from "./look/camerapose.js";
import { sphereMesh, planetLooks, orbitLines } from "./look/planets.js";
import { blobUnder, sphereShadow } from "./look/shadow.js";
import { DUMMY_COLOUR, ALIEN_ASSETS, figureMesh, dressFigure, armFigure, styleFigure, alienMaterial, jetAt, viewArm } from "./look/aliens.js";
import { createPoser } from "./look/alienpose.js";
import { WEAPON_ASSETS, weaponModels, weaponSet, swapMaterials, muzzleFlash, showFlash, spinGun, shotLooks } from "./look/weapons.js";
import { createGunWatch, viewGun, flashShown } from "./look/gunpose.js";
import { createGrapples } from "./look/grapple.js";
import { createBlasts } from "./look/blast.js";
import { PROP_ASSETS, pickupLook, padLook, cuePath, cometTailLook, cometHalo, asteroidBelt, flyingRocks } from "./look/props.js";
import { cometTails } from "./look/proppose.js";
import { loadAssets } from "./look/assets.js";
import { threeLoaders } from "./look/loaders.js";
import { createQuality, pixelRatio as levelRatio } from "./look/quality.js";

const MAX_PITCH = (89 * Math.PI) / 180;
// Where the camera looks from while you have no body yet (online, before the first snapshot).
const OVERVIEW = [0, 260, 380, 0, 0, 0];

// selfId: your entity, whose eyes the camera uses. Online it is a function, as the id comes with the
// server's welcome and changes if the server restarts. noSky: skip painting the sky, to see its fallback.
// hold: a quality level to draw at all the time (for measuring each one), instead of the automatic step.
export function createRenderer(world, canvas, fixedView = null, selfId = "player", { noSky = false, hold = null } = {}) {
  const self = typeof selfId === "function" ? selfId : () => selfId;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // The quality step's level sets the pixel ratio and which effects run; it starts at the top.
  const levels = LOOK.quality.res.length, pixelRatio = (l) => levelRatio(window.devicePixelRatio, l, LOOK.quality);
  const quality = createQuality({ levels, ...LOOK.quality });
  const pinned = Number.isInteger(hold) && hold >= 0 && hold < levels ? hold : null;
  let level = pinned ?? quality.level, lastNow = null;
  renderer.setPixelRatio(pixelRatio(level));
  const scene = new THREE.Scene();
  // The sky is painted once; plain space if it can't be. A lost and restored WebGL context loses the painting
  // too (three remakes its own resources, not what was drawn into them), so it is painted again.
  const paintSky = () => {
    const sky = nebulaSky(renderer, { skip: noSky });
    scene.background = sky ? sky.texture : new THREE.Color(PLAIN_SPACE);
  };
  paintSky();
  scene.backgroundIntensity = LOOK.sky.intensity;
  canvas.addEventListener("webglcontextrestored", paintSky);
  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 5000);
  scene.add(camera);
  const rand = rng(7);
  // Models and images: each look module lists its files here and swaps them in when they arrive; until then
  // (or if one never does) it draws its simple shape.
  const assets = loadAssets([...ALIEN_ASSETS, ...WEAPON_ASSETS, ...PROP_ASSETS], { loaders: threeLoaders() });

  // three.js r160 lights are physically based (diffuse divided by pi), hence the large numbers. The night
  // side of a planet must stay readable.
  scene.add(new THREE.AmbientLight(0xa3acd0, 0.45));
  const sunLight = new THREE.PointLight(0xfff1d6, LOOK.sun.light, 0, 0);
  scene.add(sunLight, starfield(rand));

  const rings = orbitLines(world.system);
  for (const r of rings) scene.add(r.ring);

  // The sun first, then the planets, moons and comets: the order they draw from `rand` in.
  const bodies = {}, tails = [];
  const sun = sunLook(world.system.sun, rand);
  const planets = planetLooks(world.system, renderer, rand);
  for (const b of world.system.bodies) {
    const m = b.kind === "sun" ? sun.mesh : planets.meshes[b.id] ?? sphereMesh(b, rand);
    if (b.kind === "comet") {
      const halo = cometHalo(b);
      m.add(halo.group);
      tails.push({ id: b.id, look: cometTailLook(), halo });
    }
    bodies[b.id] = m;
    scene.add(m);
  }
  for (const t of tails) scene.add(t.look.group);
  scene.add(sun.flare);
  const storm = flareLook(world.system.sun);
  sun.mesh.add(storm.arches);
  storm.setLevel(level);
  scene.add(storm.shell, storm.cloud);
  sun.setLevel(level);
  planets.setLevel(level);
  // Everything that can hide the sun, and the ground blob shadows fall on.
  const blockers = world.system.bodies.filter((b) => b.kind !== "sun").map((b) => ({ id: b.id, pos: null, radius: b.radius }));
  const sunRadius = world.system.sun.radius;
  const belt = asteroidBelt(rand);
  scene.add(belt.group);
  // Its own random stream, so the shared one (and every body made from it) is as it was.
  const outerRing = asteroidBelt(rng(LOOK.outerRing.seed), LOOK.outerRing, { tumble: false });
  outerRing.group.visible = level >= LOOK.outerRing.from;
  scene.add(outerRing.group);

  // Pads ride on their bodies: keep each pad's offset from its body's centre.
  const pads = world.pads.map((pad) => {
    const body = world.system.byId[pad.body];
    const at = padPos(world, pad, world.poses);
    const offset = sub(at, world.poses[pad.body].pos);
    const n = surfaceInfo(body, world.poses[pad.body], at).normal;
    const look = padLook(n, pad.dir);
    scene.add(look.group);
    return { pad, offset, look };
  });
  const { path, pathGeo, pathMat } = cuePath();
  scene.add(path);

  // The gun in view rides a holder on the camera, placed by look/gunpose.js from your shots alone; the model's
  // guns replace the simple ones when they load. Its materials take the sun away where a planet hides it.
  const holder = new THREE.Group();
  camera.add(holder);
  let weapons = weaponModels(), viewMats = swapMaterials(weapons, alienMaterial), viewArmed = false;
  holder.add(...Object.values(weapons));
  let arm = null; // your arm holding it, once the alien model loads (false if it has none)
  const viewFlash = muzzleFlash();
  const watch = createGunWatch(); // everyone's last shot, for kicks, flashes and the minigun's spin

  // Pickups float over their spots; each has a solid look and a faint one for while it is gone.
  const pickups = PICKUPS.map((pk) => {
    const look = pickupLook(pk);
    scene.add(look.group);
    return { pk, look };
  });
  const grapples = createGrapples(scene);

  const looks = shotLooks(), { rocketGeo, rocketMat, bulletGeo, bulletMat } = looks;
  const shots = [], beams = [];
  const blastLooks = createBlasts(scene);
  blastLooks.setLevel(level);
  const pooled = (list, make) => (i) => list[i] || (list[i] = (() => { const m = make(); scene.add(m); return m; })());
  // Flying asteroids: the trail is kept per rock id and dropped with the rock.
  const rockLook = flyingRocks();
  const rockTrails = new Map(); // rock id -> { mesh, line, pts: [x, y, z, ...] newest first, seen }
  const rockTrail = (id) => {
    let k = rockTrails.get(id);
    if (!k) {
      const { mesh, line } = rockLook.make();
      scene.add(mesh, line);
      rockTrails.set(id, (k = { mesh, line, pts: [], seen: 0 }));
    }
    return k;
  };
  const hot = new THREE.Color(ROCK_LOOK.trailColor);
  let rockFrame = 0;
  const figures = [];
  const figure = pooled(figures, figureMesh); // everyone but you
  const poser = createPoser();
  // Boosters' exhaust, kept per entity id: laid while one boosts, fading from the far end after.
  const exhausts = new Map(); // id -> { points, colour, pts: [x, y, z, ...] newest first, t }
  const exhaust = (id, colour) => {
    let k = exhausts.get(id);
    if (!k) {
      const n = LOOK.alien.jet.trail, geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * n), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3 * n), 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: LOOK.alien.jet.trailSize, map: haloMap(), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      points.frustumCulled = false;
      scene.add(points);
      exhausts.set(id, (k = { points, colour: new THREE.Color(), pts: [], t: -1 }));
    }
    k.colour.setHex(colour);
    return k;
  };
  const flashAt = {}; // entity id -> when its bar began to flash (real seconds: the match clock can go back)
  const shot = pooled(shots, looks.shot);
  const beam = pooled(beams, looks.beam);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  // An entity's interpolated feet and up.
  const between = (e, alpha) => (e.prev ? { pos: lerp(e.prev.pos, e.pos, alpha), up: norm(lerp(e.prev.up, e.up, alpha)) } : { pos: e.pos, up: e.up });

  // The soft shadows under figures, pickups and flying rocks, nearest to the eye first (the shader takes the
  // first LOOK.planets.blob.max). Your own counts too, as you can see it under you, but not under a free
  // camera. Needs the blockers moved to this frame. The blob objects are reused frame to frame.
  const blobPool = [], blobList = [], byDistance = (a, b) => a.d - b.d;
  const blobsNear = (p, free, alpha, poses, viewer) => {
    blobList.length = 0;
    const put = (pos, size) => {
      const n = blobList.length;
      if (n === blobPool.length) blobPool.push({ at: [0, 0, 0], radius: 0, strength: 0, d: 0 });
      const b = blobUnder(pos, size, blockers, LOOK.planets.blob, blobPool[n]);
      if (b) (b.d = dist(b.at, viewer)), blobList.push(b);
    };
    for (const id in world.entities) {
      const e = world.entities[id];
      if (e.alive && !(e === p && free)) put(e.prev ? lerp(e.prev.pos, e.pos, alpha) : e.pos, PLAYER.hit.body.r * 2);
    }
    for (const pk of PICKUPS) {
      if (!pickupReady(world, pk)) continue;
      const b = world.system.byId[pk.body];
      put(add(poses[pk.body], scale(pk.dir, b.radius + 0.7)), 0.45);
    }
    for (const a of world.asteroids) put(a.pos, ASTEROID.radius);
    return blobList.sort(byDistance);
  };

  let shown = { orbits: true, cues: true, tags: true, third: false }, aim = null;
  return {
    // Your own choices (O, P and V): { orbits, cues, third }. Cues cover the dashed path and the pad's light. tags: name
    // tags and bars over others (the look check hides them to measure a figure alone).
    setShown(s) {
      shown = { ...shown, ...s };
      for (const r of rings) r.ring.visible = shown.orbits;
    },
    // A hit event for someone: their bar flashes white for a moment (it reacts to the server's confirmation).
    // now: real seconds.
    event(ev, now) {
      if (ev.type === "hit") flashAt[ev.id] = now;
    },
    // The quality level drawn at and the last frame's draw calls and triangles (the look check's measure).
    stats: () => ({ level, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    // The camera as last drawn: { pos, right, up, forward }, for the HUD's hit arcs.
    // In third person, where the crosshair goes: the screen point (CSS px from the canvas's top left) where a
    // shot from your eye lands; null in first person (the middle of the screen).
    crosshair: () => aim,
    camera() {
      const m = camera.matrixWorld.elements;
      return { pos: [m[12], m[13], m[14]], right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], forward: [-m[8], -m[9], -m[10]] };
    },
    // alpha: how far towards the next tick to draw (0..1); look: mouse turn not yet given to the sim;
    // zoom: the sniper's magnification while zoomed, else 1; shift: added to where you are drawn (online,
    // a prediction's correction eased in); now: real seconds, for the bars' hit flash; feel: your own boost
    // (look/gunpose.js thrustView), which widens the view and shakes the gun in it.
    draw(alpha, look, zoom = 1, shift = null, now = 0, feel = null) {
      if (pinned === null && lastNow !== null && quality.frame(now - lastNow) !== level) {
        level = quality.level;
        renderer.setPixelRatio(pixelRatio(level));
        sun.setLevel(level);
        planets.setLevel(level);
        storm.setLevel(level);
        blastLooks.setLevel(level);
        outerRing.group.visible = level >= LOOK.outerRing.from;
      }
      const dt = lastNow === null ? 0 : now - lastNow;
      lastNow = now;
      resize();
      // Zoomed in, the sniper's view stays steady.
      const fov = zoom === 1 && feel && !fixedView ? 80 + feel.fov : 80 / zoom;
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      const poses = {};
      for (const b of world.system.bodies) {
        const pos = lerp(world.prevPoses[b.id].pos, world.poses[b.id].pos, alpha);
        poses[b.id] = pos;
        bodies[b.id].position.copy(v3(pos));
      }
      sunLight.position.copy(v3(poses.sun));
      for (const r of rings) r.ring.position.copy(v3(poses[r.around]));
      // Tails point away from the sun and grow as the comet nears it; the dust tail trails the path.
      for (const t of tails) t.look.update(cometTails(poses[t.id], world.poses[t.id].vel, poses.sun));
      const props = assets.get("props");
      if (props) belt.dress(props), rockLook.dress(props), outerRing.dress(props);
      belt.update(world.t + (alpha - 1) * TICK);
      outerRing.update(world.t + (alpha - 1) * TICK);

      const p = world.entities[self()];
      // You, interpolated and shifted.
      const mine = () => {
        const { pos, up } = between(p, alpha);
        return { pos: shift ? add(pos, shift) : pos, up };
      };
      const free = fixedView || (!p && OVERVIEW);
      // Third person: over the shoulder, while alive and not zoomed (the sniper's zoom is first person).
      const third = !free && shown.third && p.alive && zoom === 1;
      aim = null;
      if (free) {
        camera.position.set(free[0], free[1], free[2]);
        camera.up.set(0, 1, 0);
        camera.lookAt(free[3], free[4], free[5]);
      } else {
        const { pos, up } = mine();
        let fwd = rotateFromTo(p.forward, p.up, up);
        fwd = rotateAxis(fwd, up, -look.yaw);
        const pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, p.pitch + look.pitch));
        const dir = add(scale(fwd, Math.cos(pitch)), scale(up, Math.sin(pitch)));
        const eye = add(pos, scale(up, PLAYER.eye));
        const at = third ? thirdCamera(eye, dir, up, world.system, world.poses) : eye;
        camera.position.copy(v3(at));
        camera.up.copy(v3(up));
        camera.lookAt(v3(add(at, dir)));
        if (third) {
          camera.updateMatrixWorld();
          const s = v3(aimPoint(world, p, eye, dir)).project(camera), r = canvas.getBoundingClientRect();
          aim = s.z < 1 ? { x: ((s.x + 1) / 2) * r.width, y: ((1 - s.y) / 2) * r.height } : null;
        }
      }
      // Figures are lit by the sun only where no body hides it from their head, as the ground is; the gun in
      // view where none hides it from your eye.
      for (const k of blockers) k.pos = poses[k.id];
      const viewer = camera.position.toArray();
      const guns = assets.get("weapons");
      if (guns && !viewArmed) {
        holder.remove(...Object.values(weapons));
        ({ guns: weapons, materials: viewMats } = weaponSet(guns, alienMaterial));
        if (arm) viewMats.push(...arm.lit);
        holder.add(...Object.values(weapons));
        viewArmed = true;
      }
      const held = !free && !third && p.alive && zoom === 1 ? weapons[p.weapon] : null;
      for (const m of Object.values(weapons)) m.visible = m === held;
      const alienModel = assets.get("alien");
      if (alienModel && arm === null && (arm = viewArm(alienModel) || false)) {
        holder.add(arm.arm);
        viewMats.push(...arm.lit);
      }
      if (arm) {
        arm.arm.visible = !!held;
        if (held) arm.paint(world.players[p.id]?.colour ?? COLOURS[0]);
      }
      const mineShot = !free && p.alive ? watch.frame(p, now) : null;
      if (mineShot) {
        const at = viewGun(p.weapon, mineShot.since), push = feel ? feel.gun : [0, 0, 0];
        holder.position.set(at.pos[0] + push[0], at.pos[1] + push[1], at.pos[2] + push[2]);
        holder.rotation.x = at.pitch;
        holder.scale.setScalar(at.scale);
        if (held) spinGun(held, mineShot.since, dt);
        let seen = 1;
        for (const k of blockers) seen *= sphereShadow(viewer, poses.sun, sunRadius, k.pos, k.radius);
        for (const m of viewMats) m.userData.sun.value = seen * LOOK.weapons.sun;
      }
      showFlash(viewFlash, held, !!held && flashShown(mineShot.since), mineShot, p?.shots);
      camera.updateMatrixWorld(true); // the gun's muzzle is where your own beam starts

      // How much of the sun a body hides from a point (pads, pickups).
      const sunAt = (at) => {
        let seen = 1;
        for (const k of blockers) seen *= sphereShadow(at, poses.sun, sunRadius, k.pos, k.radius);
        return seen;
      };
      let nearest = null;
      for (const pd of pads) {
        const at = add(poses[pd.pad.body], pd.offset);
        pd.look.group.position.copy(v3(at));
        if (props) pd.look.dress(props);
        const on = !!world.cues[pd.pad.id]?.landsOn;
        // Cues hidden: neutral grey, since a pad that is always red would read as "never lands".
        pd.look.cue(!shown.cues ? LOOK.props.pads.hidden : on ? LOOK.props.pads.lands : LOOK.props.pads.misses, sunAt(add(at, scale(norm(pd.offset), 0.5))));
        const d = dist(at, viewer);
        if (d < PAD_CUE.showPathWithin && (!nearest || d < nearest.d)) nearest = { pd, d };
      }
      const cue = shown.cues && nearest && world.cues[nearest.pd.pad.id];
      path.visible = !!cue;
      if (cue) {
        // The cue was computed up to a quarter second ago, and the pad's planet has moved on since. Carry
        // the path along with the planet, so it starts on the pad every frame instead of drifting off and
        // snapping back at each refresh (which looks like flicker up close).
        const body = nearest.pd.pad.body;
        const shift = sub(poses[body], posesAt(world.system, cue.at)[body].pos);
        const arr = pathGeo.attributes.position.array, n = Math.min(cue.path.length, 1024);
        for (let i = 0; i < n; i++) arr.set(add(cue.path[i], shift), 3 * i);
        pathGeo.attributes.position.needsUpdate = true;
        pathGeo.setDrawRange(0, n);
        path.computeLineDistances(); // dashes follow the new path
        pathMat.color.setHex(cue.landsOn ? LOOK.props.pads.lands : LOOK.props.pads.misses);
      }

      const alien = assets.get("alien");
      let i = 0;
      for (const [id, d] of Object.entries(world.entities)) {
        // In first person you are the view, not a figure in it; in third person too while the camera is pressed
        // in close (looking steeply up or against a wall), where your figure would fill the screen.
        if (d === p && (!third || camera.position.distanceTo(v3(add(mine().pos, scale(mine().up, PLAYER.eye)))) < LOOK.third.near)) continue;
        if (!d.alive) {
          poser.drop(id); // a respawn starts its pose afresh
          continue;
        }
        const m = figure(i++);
        m.visible = true;
        if (alien && !m.userData.alien) dressFigure(m, alien);
        if (guns && m.userData.alien && !m.userData.alien.armed) armFigure(m, guns);
        const who = world.players[id];
        m.userData.tag.visible = shown.tags && d !== p;
        m.userData.tag.userData.show(who ? who.name : "Dummy", d.health / (d.kind === "dummy" ? DUMMY.health : PLAYER.health), now >= flashAt[id] && now - flashAt[id] < FEEDBACK.flash);
        const { pos, up } = d === p ? mine() : between(d, alpha);
        const fwd = norm(rotateFromTo(d.forward, d.up, up)), right = cross(fwd, up);
        m.matrix.makeBasis(v3(right), v3(up), v3(scale(fwd, -1))).setPosition(v3(pos));
        const head = add(pos, scale(up, PLAYER.hit.head.at));
        let lit = 1;
        for (const k of blockers) lit *= sphereShadow(head, poses.sun, sunRadius, k.pos, k.radius);
        const colour = who ? who.colour : DUMMY_COLOUR;
        styleFigure(m, colour, poser.frame(d, now, dt), d.weapon, lit, watch.frame(d, now), d.shots, dt, poser.boosting(d));
        const jet = jetAt(m);
        if (jet) trailPush(exhaust(id, colour), jet, world.t, LOOK.alien.jet.trail);
      }
      for (; i < figures.length; i++) figures[i].visible = false;
      // Exhaust: one point per game tick while boosting (so it spans the same time on any screen), then
      // fading from its far end; brightest at the nozzle, in the booster's colour.
      for (const [id, k] of exhausts) {
        if (trailFade(k, world.t)) { // a boost this tick laid a point already, so nothing fades
          scene.remove(k.points);
          k.points.geometry.dispose();
          k.points.material.dispose();
          exhausts.delete(id);
          continue;
        }
        const n = k.pts.length / 3, pos = k.points.geometry.attributes.position, col = k.points.geometry.attributes.color;
        pos.array.set(k.pts);
        for (let j = 0; j < n; j++) {
          const f = LOOK.alien.jet.trailGlow * (1 - j / n) ** 1.5;
          col.array.set([k.colour.r * f, k.colour.g * f, k.colour.b * f], 3 * j);
        }
        pos.needsUpdate = col.needsUpdate = true;
        k.points.geometry.setDrawRange(0, n);
      }
      poser.sweep(now - 1);
      watch.sweep(now - 1);

      i = 0;
      for (const s of world.projectiles) {
        const m = shot(i++);
        m.visible = true;
        m.geometry = s.kind === "rocket" ? rocketGeo : bulletGeo;
        m.material = s.kind === "rocket" ? rocketMat : bulletMat;
        m.position.copy(v3(s.pos));
        m.quaternion.setFromUnitVectors(Y, v3(norm(s.vel)));
      }
      for (; i < shots.length; i++) shots[i].visible = false;
      const frameNo = ++rockFrame;
      for (const a of world.asteroids) {
        const k = rockTrail(a.id);
        k.seen = frameNo;
        k.mesh.position.copy(v3(a.pos));
        rockLook.fit(k.mesh, a.id);
        k.mesh.rotation.set(...tumble(a.id, world.t), 0);
        // One trail point per game tick (not per frame), so the trail lasts the same on any screen; each lit by
        // how hot the rock was when it laid it, so it shows only along the fall in.
        trailPush(k, a.pos, world.t, ROCK_LOOK.trail, rockHeat(a, world.system, world.poses));
        const last = k.pts, n = last.length / 3, pos = k.line.geometry.attributes.position, col = k.line.geometry.attributes.color;
        pos.array.set(last);
        for (let j = 0; j < n; j++) {
          const f = 0.5 * (1 - j / n) ** 1.5 * k.heats[j]; // additive dots pile up, so start dim or the near end whites out
          col.array.set([hot.r * f, hot.g * f, hot.b * f], 3 * j);
        }
        pos.needsUpdate = col.needsUpdate = true;
        k.line.geometry.setDrawRange(0, n);
      }
      for (const [id, k] of rockTrails) {
        if (k.seen === frameNo) continue;
        scene.remove(k.mesh, k.line);
        k.line.geometry.dispose();
        k.line.material.dispose();
        rockTrails.delete(id);
      }
      i = 0;
      blastLooks.update(world.explosions, now);
      i = 0;
      for (const b of world.beams) {
        const l = beam(i++);
        l.visible = true;
        // Your own beam starts at the railgun's muzzle, not your eye, or you would see it end-on as a dot.
        const from = b.owner === p?.id && !free && !third ? weapons.railgun.userData.muzzle.getWorldPosition(new THREE.Vector3()) : v3(b.from);
        l.geometry.setFromPoints([from, v3(b.to)]);
        l.material.opacity = 1 - b.age / WEAPONS.railgun.showFor;
      }
      for (; i < beams.length; i++) beams[i].visible = false;

      for (const k of tails) k.halo.update(poses[k.id], poses.sun, viewer);

      // Pickups bob and turn above their spots.
      const t = world.t + (alpha - 1) * TICK, { float, bob, bobRate, spin } = LOOK.props.pickups;
      const files = { props, weapons: guns };
      for (const { pk, look } of pickups) {
        const b = world.system.byId[pk.body];
        const at = add(poses[pk.body], scale(pk.dir, b.radius + float + bob * Math.sin(bobRate * t + b.radius)));
        look.dress(files);
        look.group.position.copy(v3(at));
        look.group.quaternion.setFromUnitVectors(Y, v3(pk.dir));
        look.group.rotateY(spin * t);
        look.show(pickupReady(world, pk), sunAt(at));
      }

      // Every hook and its rope, from just below the eye (interpolated, yours shifted as you are drawn).
      grapples.update(world, poses, alpha, now, (e) => {
        const { pos, up } = e === p ? mine() : between(e, alpha);
        return add(pos, scale(up, PLAYER.eye - 0.4));
      }, props);

      // A solar flare, from the match clock like everything else (?debug&at=T stills one).
      const fs = flareView(t);
      sun.setStorm(fs);
      planets.setStorm(fs.burn);
      sunLight.intensity = LOOK.sun.light * (1 + LOOK.flare.bleach * fs.burn);
      storm.update(fs, t, poses.sun);
      sun.update(t, dt, camera, poses.sun, blockers);
      planets.update(t, poses, blobsNear(p, free, alpha, poses, viewer), viewer);
      renderer.render(scene, camera);
    },
  };
}
