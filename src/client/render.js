// Draws the simulation with three.js: flat-shaded bodies, pads with their cue, the dummy and other
// players, shots and blasts, and the weapon in view. It only reads the world; drawing happens between the
// last two ticks (alpha) so motion stays smooth on screens faster than the 60 Hz simulation.
import * as THREE from "three";
import { PLAYER, DUMMY, ROCKET, PAD_CUE, BELT, TICK, PICKUPS, WEAPONS, FEEDBACK } from "../tuning.js";
import { padPos } from "../sim/pads.js";
import { pickupReady } from "../sim/pickups.js";
import { posesAt } from "../sim/system.js";
import { surfaceInfo } from "../sim/collide.js";
import { add, sub, scale, lerp, norm, cross, dist, rotateAxis, rotateFromTo } from "../sim/vec.js";

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const Y = new THREE.Vector3(0, 1, 0);
const MAX_PITCH = (89 * Math.PI) / 180;
// Where the camera looks from while you have no body yet (online, before the first snapshot).
const OVERVIEW = [0, 260, 380, 0, 0, 0];

// Deterministic randomness, so every load looks the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A faceted sphere whose faces vary a little in shade, so running across it shows motion.
function sphereMesh(body, rand) {
  const geo = new THREE.IcosahedronGeometry(body.radius, body.kind === "sun" ? 4 : 3); // already one vertex per face corner
  const base = new THREE.Color(body.color), colors = [];
  for (let i = 0; i < geo.attributes.position.count; i += 3) {
    const c = base.clone().offsetHSL(0, 0, (rand() - 0.5) * (body.kind === "sun" ? 0.06 : 0.12));
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mat = body.kind === "sun"
    ? new THREE.MeshBasicMaterial({ vertexColors: true })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  if (body.kind !== "sun") {
    // Low mounds pressed into the surface: landmarks you can walk over.
    const mound = new THREE.MeshLambertMaterial({ color: base.clone().offsetHSL(0, -0.05, -0.12), flatShading: true });
    const n = Math.round(body.radius * body.radius * 0.35);
    for (let i = 0; i < n; i++) {
      const u = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      const r = 0.5 + rand() * 1.4;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mound);
      m.scale.set(1, 0.25, 1);
      m.quaternion.setFromUnitVectors(Y, u);
      m.position.copy(u).multiplyScalar(body.radius - 0.05);
      mesh.add(m);
    }
  }
  return mesh;
}

// A comet's tail: an open cone, its base at the comet and its tip pointing away (set per frame).
function cometTail() {
  const geo = new THREE.ConeGeometry(1, 1, 12, 1, true);
  geo.translate(0, 0.5, 0); // wide end at the comet, tip out along +y
  const mat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// A flat ring like Saturn's, riding on its planet (planets don't spin). Looks only.
function planetRing(body) {
  const { inner, outer, tilt } = body.ring;
  const geo = new THREE.RingGeometry(body.radius * inner, body.radius * outer, 96);
  const mat = new THREE.MeshBasicMaterial({ color: 0xcbb8f0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2 + (tilt * Math.PI) / 180;
  return ring;
}

// The asteroid belt: one instanced mesh of tumbling rocks, turning round the sun the way the planets go.
// Looks only, so it lives here and not in the simulation.
function asteroidBelt(rand) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), BELT.rocks);
  const rocks = [], base = new THREE.Color(0x8d7f73);
  for (let i = 0; i < BELT.rocks; i++) {
    const r = BELT.inner + rand() * (BELT.outer - BELT.inner), a = rand() * 2 * Math.PI;
    const s = BELT.size[0] + rand() * (BELT.size[1] - BELT.size[0]);
    rocks.push({
      pos: new THREE.Vector3(r * Math.cos(a), (rand() - 0.5) * BELT.thick, r * Math.sin(a)),
      scale: new THREE.Vector3(s, s * (0.6 + rand() * 0.4), s * (0.7 + rand() * 0.3)),
      axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
      rate: 0.2 + rand() * 0.8,
    });
    mesh.setColorAt(i, base.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.15));
  }
  const group = new THREE.Group();
  group.add(mesh);
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  return {
    group,
    update(t) {
      group.rotation.y = (-2 * Math.PI * t) / BELT.period; // three's +y turn runs x towards -z; orbits go x towards +z
      rocks.forEach((k, i) => mesh.setMatrixAt(i, m.compose(k.pos, q.setFromAxisAngle(k.axis, k.rate * t), k.scale)));
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function glowSprite(color, size) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = new THREE.Color(color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  grad.addColorStop(0, `rgba(${rgb},0.9)`);
  grad.addColorStop(0.35, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(size, size, 1);
  return s;
}

function starfield(rand) {
  const pos = [];
  for (let i = 0; i < 2500; i++) {
    const u = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(1800);
    pos.push(u.x, u.y, u.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false }));
}

const DUMMY_COLOUR = 0xff7a3d;

// The name and health bar over a head: a canvas drawn again only when what it shows changes. The depth
// test hides it behind planets; it shrinks with distance like anything else in the scene.
function tagSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = PLAYER.height + 0.5;
  let shown = null;
  // fraction: health 0..1; flash: the bar is white for a moment after a hit.
  sprite.userData.show = (name, fraction, flash) => {
    const key = `${name}|${Math.round(fraction * 200)}|${flash}`;
    if (key === shown) return;
    shown = key;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000a";
    ctx.strokeText(name, 128, 28);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, 128, 28);
    ctx.fillStyle = "#000a";
    ctx.fillRect(24, 40, 208, 16);
    ctx.fillStyle = flash ? "#fff" : "#5fd36b";
    ctx.fillRect(28, 44, 200 * Math.max(0, Math.min(1, fraction)), 8);
    tex.needsUpdate = true;
  };
  return sprite;
}

// A body sphere and a head sphere, exactly the shapes shots test (PLAYER.hit), the face on the head's
// forward side, and the tag overhead.
function dummyMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: DUMMY_COLOUR });
  for (const { at, r } of [PLAYER.hit.body, PLAYER.hit.head]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
    ball.position.y = at;
    g.add(ball);
  }
  g.userData.body = { material: mat }; // one material for both, so the colour is set once
  g.userData.tag = tagSprite();
  g.add(g.userData.tag);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), white);
    eye.position.set(sx * 0.17, 1.32, -0.5);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), black);
    pupil.position.set(sx * 0.17, 1.32, -0.6);
    g.add(eye, pupil);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI), black);
  mouth.position.set(0, 1.08, -0.5);
  mouth.rotation.z = Math.PI;
  g.add(mouth);
  return g;
}

// Small and low in the corner of the view, lit by their own colour so they read on the night side too.
function weaponModels() {
  const lit = (color) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const pistol = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.045), lit(0x4a5160));
  grip.position.set(0, -0.045, 0.02);
  grip.rotation.x = -0.3;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.16), lit(0x8fa1b8));
  barrel.position.set(0, 0.01, -0.04);
  pistol.add(grip, barrel);
  pistol.position.set(0.16, -0.15, -0.42);
  const rocket = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0x5f8f4e, emissive: 0x5f8f4e, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  tube.rotation.x = Math.PI / 2;
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.052, 14), new THREE.MeshBasicMaterial({ color: 0x15171c }));
  bore.position.z = -0.249;
  rocket.add(tube, bore);
  rocket.position.set(0.18, -0.17, -0.5);
  // The other four from boxes and tubes, each in its own colour (as their pickups are).
  const gun = (color, parts, at) => {
    const g = new THREE.Group();
    for (const [w, h, d, x, y, z] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit(color));
      m.position.set(x, y, z);
      g.add(m);
    }
    g.position.set(...at);
    return g;
  };
  const shotgun = gun(WEAPON_COLORS.shotgun, [[0.06, 0.06, 0.42, 0, 0.01, -0.12], [0.07, 0.05, 0.18, 0, -0.04, 0.06]], [0.17, -0.16, -0.45]);
  const minigun = gun(WEAPON_COLORS.minigun, [[0.11, 0.11, 0.36, 0, 0, -0.1], [0.04, 0.04, 0.2, 0.03, 0.03, -0.36], [0.04, 0.04, 0.2, -0.03, -0.03, -0.36]], [0.18, -0.17, -0.48]);
  const sniper = gun(WEAPON_COLORS.sniper, [[0.04, 0.05, 0.6, 0, 0, -0.18], [0.05, 0.05, 0.14, 0, 0.06, -0.08]], [0.16, -0.15, -0.45]);
  const railgun = gun(WEAPON_COLORS.railgun, [[0.07, 0.07, 0.5, 0, 0, -0.14], [0.09, 0.02, 0.4, 0, 0.05, -0.14], [0.09, 0.02, 0.4, 0, -0.05, -0.14]], [0.17, -0.16, -0.47]);
  return { pistol, shotgun, rocket, minigun, sniper, railgun };
}

const WEAPON_COLORS = { pistol: 0x8fa1b8, shotgun: 0xc98a4b, rocket: 0x5f8f4e, minigun: 0x9a9fa8, sniper: 0x4b7bc9, railgun: 0x3fe0d0 };

// A pickup's look: health a white box with a red cross, fuel an orange can, a weapon a long bar and ammo
// a small box in the weapon's colour. The same shape as a faint wireframe marks a spot waiting to refill.
function pickupMesh(pk, wire) {
  const mat = (color) => (wire
    ? new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.25 })
    : new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.4 }));
  const g = new THREE.Group();
  if (pk.kind === "health") {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat(0xffffff)));
    if (!wire) {
      for (const [w, h] of [[0.62, 0.18], [0.18, 0.62]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.62), mat(0xe0443e)));
    }
  } else if (pk.kind === "fuel") {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 12), mat(0xff9a2e)));
  } else if (pk.kind === "weapon") {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 1.1), mat(WEAPON_COLORS[pk.weapon])));
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat(WEAPON_COLORS[pk.weapon])));
  }
  return g;
}

// selfId: your entity, whose eyes the camera uses. Online it is a function, as the id comes with the
// server's welcome and changes if the server restarts.
export function createRenderer(world, canvas, fixedView = null, selfId = "player") {
  const self = typeof selfId === "function" ? selfId : () => selfId;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060d);
  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 5000);
  scene.add(camera);
  const rand = rng(7);

  // three.js r160 lights are physically based (diffuse divided by pi), hence the large numbers. The night
  // side of a planet must stay readable.
  scene.add(new THREE.AmbientLight(0xa3acd0, 0.45));
  const sunLight = new THREE.PointLight(0xfff1d6, 7, 0, 0);
  scene.add(sunLight, starfield(rand));

  // Faint orbit rings, so you can see where a planet will come round. A moon's ring rides on its planet.
  // A comet's ellipse is sampled from the simulation's own poses, so the line is exactly its path.
  const rings = [];
  for (const b of world.system.bodies.filter((b) => b.orbit)) {
    const pts = [];
    if (b.orbit.peri) {
      for (let i = 0; i <= 256; i++) pts.push(v3(posesAt(world.system, (i / 256) * b.orbit.period)[b.id].pos));
    } else {
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * 2 * Math.PI;
        pts.push(new THREE.Vector3(b.orbit.radius * Math.cos(a), 0, b.orbit.radius * Math.sin(a)));
      }
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x39406a }));
    rings.push({ ring, around: b.orbit.around });
    scene.add(ring);
  }

  const bodies = {}, tails = [];
  for (const b of world.system.bodies) {
    const m = sphereMesh(b, rand);
    if (b.kind === "sun") m.add(glowSprite(0xffb43d, b.radius * 6));
    if (b.kind === "comet") {
      m.add(glowSprite(0xbfe8ff, b.radius * 5));
      tails.push({ id: b.id, mesh: cometTail() });
    }
    if (b.ring) m.add(planetRing(b));
    bodies[b.id] = m;
    scene.add(m);
  }
  for (const t of tails) scene.add(t.mesh);
  const belt = asteroidBelt(rand);
  scene.add(belt.group);

  // Pads ride on their bodies: keep each pad's offset from its body's centre.
  const pads = world.pads.map((pad) => {
    const body = world.system.byId[pad.body];
    const at = padPos(world, pad, world.poses);
    const offset = sub(at, world.poses[pad.body].pos);
    const n = surfaceInfo(body, world.poses[pad.body], at).normal;
    const mat = new THREE.MeshLambertMaterial({ color: 0xe0443e });
    const g = new THREE.Group();
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.25, 20), mat);
    disk.quaternion.setFromUnitVectors(Y, v3(n));
    disk.position.copy(v3(scale(n, 0.1)));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 10), mat);
    arrow.quaternion.setFromUnitVectors(Y, v3(pad.dir));
    arrow.position.copy(v3(add(scale(n, 0.5), scale(pad.dir, 0.5))));
    g.add(disk, arrow);
    scene.add(g);
    return { pad, offset, g, mat };
  });
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 1024), 3));
  // Dashed, so a cue can't be mistaken for an orbit line.
  const pathMat = new THREE.LineDashedMaterial({ color: 0x3ee05a, dashSize: 1, gapSize: 0.7 });
  const path = new THREE.Line(pathGeo, pathMat);
  path.frustumCulled = false;
  scene.add(path);

  const weapons = weaponModels();
  camera.add(...Object.values(weapons));

  // Pickups float over their spots; each has a solid look and a faint one for while it is gone.
  const pickups = PICKUPS.map((pk) => {
    const solid = pickupMesh(pk, false), ghost = pickupMesh(pk, true);
    scene.add(solid, ghost);
    return { pk, solid, ghost };
  });
  // The rope, from the hand to where the hook caught.
  const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd9d2c0 }));
  rope.frustumCulled = false;
  scene.add(rope);
  const beamMat = () => new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true });

  const rocketGeo = new THREE.CapsuleGeometry(0.12, 0.45, 4, 8), rocketMat = new THREE.MeshLambertMaterial({ color: 0xd8dde6 });
  const bulletGeo = new THREE.SphereGeometry(0.09, 8, 6), bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff27a });
  const blastGeo = new THREE.SphereGeometry(1, 16, 12);
  const shots = [], blasts = [], beams = [];
  const pooled = (list, make) => (i) => list[i] || (list[i] = (() => { const m = make(); scene.add(m); return m; })());
  const figures = [];
  const figure = pooled(figures, dummyMesh); // everyone but you
  const flashAt = {}; // entity id -> when its bar began to flash (real seconds: the match clock can go back)
  const shot = pooled(shots, () => new THREE.Mesh(rocketGeo, rocketMat));
  const blast = pooled(blasts, () => new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, depthWrite: false })));
  const beam = pooled(beams, () => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), beamMat());
    l.frustumCulled = false;
    return l;
  });

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

  return {
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
        pd.mat.color.setHex(on ? 0x3ee05a : 0xe0443e);
        const d = dist(at, viewer);
        if (d < PAD_CUE.showPathWithin && (!nearest || d < nearest.d)) nearest = { pd, d };
      }
      const cue = nearest && world.cues[nearest.pd.pad.id];
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
      i = 0;
      for (const x of world.explosions) {
        const m = blast(i++), k = x.age / ROCKET.showFor;
        m.visible = true;
        m.position.copy(v3(x.pos));
        m.scale.setScalar(0.5 + (ROCKET.splash - 0.5) * Math.sqrt(k));
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

      renderer.render(scene, camera);
    },
  };
}
