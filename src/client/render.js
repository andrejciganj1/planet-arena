// Draws the simulation with three.js: the bodies, pads with their cue, the dummy and other
// players, shots and blasts, and the weapon in view. It only reads the world; drawing happens between the
// last two ticks (alpha) so motion stays smooth on screens faster than the 60 Hz simulation. What each
// thing looks like lives in look/ (sky, sun, planets, aliens, weapons, props); this file keeps the scene,
// camera, lights and the frame, and moves the pieces to where the world says they are.
import * as THREE from "three";
import { tumble, trailPush } from "./rocklook.js";
import { PLAYER, DUMMY, ROCKET, PAD_CUE, TICK, PICKUPS, WEAPONS, FEEDBACK, ROCK_LOOK, LOOK, ASTEROID } from "../tuning.js";
import { padPos } from "../sim/pads.js";
import { pickupReady } from "../sim/pickups.js";
import { posesAt } from "../sim/system.js";
import { surfaceInfo } from "../sim/collide.js";
import { add, sub, scale, lerp, norm, cross, dist, rotateAxis, rotateFromTo } from "../sim/vec.js";
import { rng, v3, Y } from "./look/common.js";
import { starfield, nebulaSky, PLAIN_SPACE } from "./look/sky.js";
import { glowSprite, sunLook } from "./look/sun.js";
import { sphereMesh, planetLooks, orbitLines } from "./look/planets.js";
import { blobUnder } from "./look/shadow.js";
import { DUMMY_COLOUR, dummyMesh } from "./look/aliens.js";
import { weaponModels, shotLooks } from "./look/weapons.js";
import { pickupMesh, padMesh, cuePath, ropeLine, cometTail, asteroidBelt, flyingRocks } from "./look/props.js";
import { loadAssets } from "./look/assets.js";
import { threeLoaders } from "./look/loaders.js";
import { createQuality } from "./look/quality.js";

const MAX_PITCH = (89 * Math.PI) / 180;
// Where the camera looks from while you have no body yet (online, before the first snapshot).
const OVERVIEW = [0, 260, 380, 0, 0, 0];

// selfId: your entity, whose eyes the camera uses. Online it is a function, as the id comes with the
// server's welcome and changes if the server restarts. noSky: skip painting the sky, to see its fallback.
export function createRenderer(world, canvas, fixedView = null, selfId = "player", { noSky = false } = {}) {
  const self = typeof selfId === "function" ? selfId : () => selfId;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // The quality step's level sets the pixel ratio and which effects run; it starts at the top.
  const quality = createQuality({ levels: LOOK.quality.ratio.length, ...LOOK.quality });
  let level = quality.level, lastNow = null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOOK.quality.ratio[level]));
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
  // Models and images: each look module will list its files here and swap them in when they arrive; until
  // then (or if one never does) it draws its simple shape.
  const assets = loadAssets([], { loaders: threeLoaders() });

  // three.js r160 lights are physically based (diffuse divided by pi), hence the large numbers. The night
  // side of a planet must stay readable.
  scene.add(new THREE.AmbientLight(0xa3acd0, 0.45));
  const sunLight = new THREE.PointLight(0xfff1d6, 7, 0, 0);
  scene.add(sunLight, starfield(rand));

  const rings = orbitLines(world.system);
  for (const r of rings) scene.add(r.ring);

  // The sun first, then the planets and moons, then the comets: the order they draw from `rand` in.
  const bodies = {}, tails = [];
  const sun = sunLook(world.system.bodies.find((b) => b.kind === "sun"), rand);
  const planets = planetLooks(world.system, renderer, rand);
  for (const b of world.system.bodies) {
    let m = b.kind === "sun" ? sun.mesh : planets.meshes[b.id];
    if (!m) {
      m = sphereMesh(b, rand);
      if (b.kind === "comet") {
        m.add(glowSprite(0xbfe8ff, b.radius * 5));
        tails.push({ id: b.id, mesh: cometTail() });
      }
    }
    bodies[b.id] = m;
    scene.add(m);
  }
  for (const t of tails) scene.add(t.mesh);
  scene.add(sun.flare);
  sun.setLevel(level);
  planets.setLevel(level);
  // Everything that can hide the sun, and the ground blob shadows fall on.
  const blockers = world.system.bodies.filter((b) => b.kind !== "sun").map((b) => ({ id: b.id, pos: null, radius: b.radius }));
  const belt = asteroidBelt(rand);
  scene.add(belt.group);

  // Pads ride on their bodies: keep each pad's offset from its body's centre.
  const pads = world.pads.map((pad) => {
    const body = world.system.byId[pad.body];
    const at = padPos(world, pad, world.poses);
    const offset = sub(at, world.poses[pad.body].pos);
    const n = surfaceInfo(body, world.poses[pad.body], at).normal;
    const { g, mat } = padMesh(n, pad.dir);
    scene.add(g);
    return { pad, offset, g, mat };
  });
  const { path, pathGeo, pathMat } = cuePath();
  scene.add(path);

  const weapons = weaponModels();
  camera.add(...Object.values(weapons));

  // Pickups float over their spots; each has a solid look and a faint one for while it is gone.
  const pickups = PICKUPS.map((pk) => {
    const solid = pickupMesh(pk, false), ghost = pickupMesh(pk, true);
    scene.add(solid, ghost);
    return { pk, solid, ghost };
  });
  const { rope, ropeGeo } = ropeLine();
  scene.add(rope);

  const looks = shotLooks(), { rocketGeo, rocketMat, bulletGeo, bulletMat } = looks;
  const shots = [], blasts = [], beams = [];
  const pooled = (list, make) => (i) => list[i] || (list[i] = (() => { const m = make(); scene.add(m); return m; })());
  // Flying asteroids: the trail is kept per rock id and dropped with the rock.
  const rockLook = flyingRocks();
  const rockTrails = new Map(); // rock id -> { mesh, line, pts: [x, y, z, ...] newest first, seen }
  const rockTrail = (id) => {
    let k = rockTrails.get(id);
    if (!k) {
      const { mesh, line } = rockLook();
      scene.add(mesh, line);
      rockTrails.set(id, (k = { mesh, line, pts: [], seen: 0 }));
    }
    return k;
  };
  const hot = new THREE.Color(ROCK_LOOK.trailColor);
  let rockFrame = 0;
  const figures = [];
  const figure = pooled(figures, dummyMesh); // everyone but you
  const flashAt = {}; // entity id -> when its bar began to flash (real seconds: the match clock can go back)
  const shot = pooled(shots, looks.shot);
  const blast = pooled(blasts, looks.blast);
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

  let shown = { orbits: true, cues: true, tags: true };
  return {
    // Your own choices (O and P): { orbits, cues }. Cues cover the dashed path and the pad's light. tags: name
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
    // The camera as last drawn: { pos, right, up, forward }, for the HUD's hit arcs.
    camera() {
      const m = camera.matrixWorld.elements;
      return { pos: [m[12], m[13], m[14]], right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], forward: [-m[8], -m[9], -m[10]] };
    },
    // alpha: how far towards the next tick to draw (0..1); look: mouse turn not yet given to the sim;
    // zoom: the sniper's magnification while zoomed, else 1; shift: added to where you are drawn (online,
    // a prediction's correction eased in); now: real seconds, for the bars' hit flash.
    draw(alpha, look, zoom = 1, shift = null, now = 0) {
      if (lastNow !== null && quality.frame(now - lastNow) !== level) {
        level = quality.level;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOOK.quality.ratio[level]));
        sun.setLevel(level);
        planets.setLevel(level);
      }
      const dt = lastNow === null ? 0 : now - lastNow;
      lastNow = now;
      resize();
      if (camera.fov !== 80 / zoom) {
        camera.fov = 80 / zoom;
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
      // Tails point away from the sun and grow as the comet nears it.
      for (const t of tails) {
        const away = sub(poses[t.id], poses.sun), d = Math.hypot(...away);
        t.mesh.position.copy(v3(poses[t.id]));
        t.mesh.quaternion.setFromUnitVectors(Y, v3(scale(away, 1 / d)));
        t.mesh.scale.set(2.2, Math.min(60, 12 + 1600 / d), 2.2);
      }
      belt.update(world.t + (alpha - 1) * TICK);

      const p = world.entities[self()];
      // You, interpolated and shifted.
      const mine = () => {
        const { pos, up } = between(p, alpha);
        return { pos: shift ? add(pos, shift) : pos, up };
      };
      const free = fixedView || (!p && OVERVIEW);
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
        camera.position.copy(v3(eye));
        camera.up.copy(v3(up));
        camera.lookAt(v3(add(eye, dir)));
      }
      for (const [name, m] of Object.entries(weapons)) m.visible = !free && p.alive && p.weapon === name && zoom === 1;
      const viewer = camera.position.toArray();

      let nearest = null;
      for (const pd of pads) {
        const at = add(poses[pd.pad.body], pd.offset);
        pd.g.position.copy(v3(at));
        const on = !!world.cues[pd.pad.id]?.landsOn;
        // Cues hidden: neutral grey, since a pad that is always red would read as "never lands".
        pd.mat.color.setHex(!shown.cues ? 0x8a8f9c : on ? 0x3ee05a : 0xe0443e);
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
        pathMat.color.setHex(cue.landsOn ? 0x3ee05a : 0xe0443e);
      }

      let i = 0;
      for (const [id, d] of Object.entries(world.entities)) {
        if (d === p || !d.alive) continue;
        const m = figure(i++);
        m.visible = true;
        const who = world.players[id];
        m.userData.body.material.color.setHex(who ? who.colour : DUMMY_COLOUR);
        m.userData.tag.visible = shown.tags;
        m.userData.tag.userData.show(who ? who.name : "Dummy", d.health / (d.kind === "dummy" ? DUMMY.health : PLAYER.health), now >= flashAt[id] && now - flashAt[id] < FEEDBACK.flash);
        const { pos, up } = between(d, alpha);
        const fwd = norm(rotateFromTo(d.forward, d.up, up)), right = cross(fwd, up);
        m.matrix.makeBasis(v3(right), v3(up), v3(scale(fwd, -1))).setPosition(v3(pos));
        m.matrixAutoUpdate = false;
      }
      for (; i < figures.length; i++) figures[i].visible = false;

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
        k.mesh.rotation.set(...tumble(a.id, world.t), 0);
        // One trail point per game tick (not per frame), so the trail lasts the same on any screen.
        trailPush(k, a.pos, world.t, ROCK_LOOK.trail);
        const last = k.pts, n = last.length / 3, pos = k.line.geometry.attributes.position, col = k.line.geometry.attributes.color;
        pos.array.set(last);
        for (let j = 0; j < n; j++) {
          const f = 0.5 * (1 - j / n) ** 1.5; // additive dots pile up, so start dim or the near end whites out
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
      for (const x of world.explosions) {
        const m = blast(i++), k = x.age / ROCKET.showFor;
        m.visible = true;
        m.position.copy(v3(x.pos));
        m.scale.setScalar(0.5 + (x.splash - 0.5) * Math.sqrt(k));
        m.material.opacity = 0.85 * (1 - k);
      }
      for (; i < blasts.length; i++) blasts[i].visible = false;
      i = 0;
      for (const b of world.beams) {
        const l = beam(i++);
        l.visible = true;
        // Your own beam starts at the gun, not your eye, or you would see it end-on as a dot.
        const from = b.owner === p?.id && !free ? camera.localToWorld(new THREE.Vector3(0.17, -0.16, -0.9)) : v3(b.from);
        l.geometry.setFromPoints([from, v3(b.to)]);
        l.material.opacity = 1 - b.age / WEAPONS.railgun.showFor;
      }
      for (; i < beams.length; i++) beams[i].visible = false;

      // Pickups bob and turn above their spots.
      const t = world.t + (alpha - 1) * TICK;
      for (const { pk, solid, ghost } of pickups) {
        const b = world.system.byId[pk.body];
        const at = add(poses[pk.body], scale(pk.dir, b.radius + 1 + 0.15 * Math.sin(2 * t + b.radius)));
        const ready = pickupReady(world, pk);
        for (const m of [solid, ghost]) {
          m.position.copy(v3(at));
          m.quaternion.setFromUnitVectors(Y, v3(pk.dir));
          m.rotateY(t);
        }
        solid.visible = ready;
        ghost.visible = !ready;
      }

      // The rope from just below the eye to the caught point (interpolated with its body).
      rope.visible = !!p?.alive && !!p.hook;
      if (rope.visible) {
        const { pos, up } = mine();
        const hand = add(pos, scale(up, PLAYER.eye - 0.4));
        const anchor = add(poses[p.hook.body], p.hook.offset);
        ropeGeo.setFromPoints([v3(hand), v3(anchor)]);
      }

      for (const k of blockers) k.pos = poses[k.id];
      sun.update(t, dt, camera, poses.sun, blockers);
      planets.update(t, poses, blobsNear(p, free, alpha, poses, viewer), viewer);
      renderer.render(scene, camera);
    },
  };
}
