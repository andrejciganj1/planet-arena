// Draws the simulation with three.js: flat-shaded bodies, pads with their cue, the dummy, shots and
// blasts, and the weapon in view. It only reads the world; drawing happens between the last two ticks
// (alpha) so motion stays smooth on screens faster than the 60 Hz simulation.
import * as THREE from "three";
import { PLAYER, ROCKET, PAD_CUE } from "../tuning.js";
import { padPos } from "../sim/pads.js";
import { surfaceInfo } from "../sim/collide.js";
import { add, sub, scale, lerp, norm, cross, dist, rotateAxis, rotateFromTo } from "../sim/vec.js";

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const Y = new THREE.Vector3(0, 1, 0);
const MAX_PITCH = (89 * Math.PI) / 180;

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

// A cartoon capsule with a face on its forward side.
function dummyMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - 2 * PLAYER.radius, 6, 16), new THREE.MeshLambertMaterial({ color: 0xff7a3d }));
  body.position.y = PLAYER.height / 2;
  g.add(body);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), white);
    eye.position.set(sx * 0.17, 1.42, -0.43);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), black);
    pupil.position.set(sx * 0.17, 1.42, -0.54);
    g.add(eye, pupil);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI), black);
  mouth.position.set(0, 1.18, -0.47);
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
  return { pistol, rocket };
}

export function createRenderer(world, canvas, fixedView = null) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060d);
  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 5000);
  scene.add(camera);
  const rand = rng(7);

  // three.js r160 lights are physically based (diffuse divided by pi), hence the large numbers. The night
  // side of a planet must stay readable.
  scene.add(new THREE.AmbientLight(0xa3acd0, 3.2));
  const sunLight = new THREE.PointLight(0xfff1d6, 4, 0, 0);
  scene.add(sunLight, starfield(rand));

  // Faint orbit rings, so you can see where a planet will come round. A moon's ring rides on its planet.
  const rings = [];
  for (const b of world.system.bodies.filter((b) => b.orbit)) {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * 2 * Math.PI;
      pts.push(new THREE.Vector3(b.orbit.radius * Math.cos(a), 0, b.orbit.radius * Math.sin(a)));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x39406a }));
    rings.push({ ring, around: b.orbit.around });
    scene.add(ring);
  }

  const bodies = {};
  for (const b of world.system.bodies) {
    const m = sphereMesh(b, rand);
    if (b.kind === "sun") m.add(glowSprite(0xffb43d, b.radius * 6));
    bodies[b.id] = m;
    scene.add(m);
  }

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

  const dummy = dummyMesh();
  scene.add(dummy);
  const weapons = weaponModels();
  camera.add(weapons.pistol, weapons.rocket);

  const rocketGeo = new THREE.CapsuleGeometry(0.12, 0.45, 4, 8), rocketMat = new THREE.MeshLambertMaterial({ color: 0xd8dde6 });
  const bulletGeo = new THREE.SphereGeometry(0.09, 8, 6), bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff27a });
  const blastGeo = new THREE.SphereGeometry(1, 16, 12);
  const shots = [], blasts = [];
  const pooled = (list, make) => (i) => list[i] || (list[i] = (() => { const m = make(); scene.add(m); return m; })());
  const shot = pooled(shots, () => new THREE.Mesh(rocketGeo, rocketMat));
  const blast = pooled(blasts, () => new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, depthWrite: false })));

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
    // alpha: how far towards the next tick to draw (0..1); look: mouse turn not yet given to the sim.
    draw(alpha, look) {
      resize();
      const poses = {};
      for (const b of world.system.bodies) {
        const pos = lerp(world.prevPoses[b.id].pos, world.poses[b.id].pos, alpha);
        poses[b.id] = pos;
        bodies[b.id].position.copy(v3(pos));
      }
      sunLight.position.copy(v3(poses.sun));
      for (const r of rings) r.ring.position.copy(v3(poses[r.around]));

      const p = world.entities.player;
      if (fixedView) {
        camera.position.set(fixedView[0], fixedView[1], fixedView[2]);
        camera.up.set(0, 1, 0);
        camera.lookAt(fixedView[3], fixedView[4], fixedView[5]);
      } else {
        const { pos, up } = between(p, alpha);
        let fwd = rotateFromTo(p.forward, p.up, up);
        fwd = rotateAxis(fwd, up, -look.yaw);
        const pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, p.pitch + look.pitch));
        const dir = add(scale(fwd, Math.cos(pitch)), scale(up, Math.sin(pitch)));
        const eye = add(pos, scale(up, PLAYER.eye));
        camera.position.copy(v3(eye));
        camera.up.copy(v3(up));
        camera.lookAt(v3(add(eye, dir)));
      }
      weapons.pistol.visible = !fixedView && p.alive && p.weapon === "pistol";
      weapons.rocket.visible = !fixedView && p.alive && p.weapon === "rocket";
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
        const arr = pathGeo.attributes.position.array, n = Math.min(cue.path.length, 1024);
        for (let i = 0; i < n; i++) arr.set(cue.path[i], 3 * i);
        pathGeo.attributes.position.needsUpdate = true;
        pathGeo.setDrawRange(0, n);
        path.computeLineDistances(); // dashes follow the new path
        pathMat.color.setHex(cue.landsOn ? 0x3ee05a : 0xe0443e);
      }

      const d = world.entities.dummy;
      dummy.visible = d.alive;
      if (d.alive) {
        const { pos, up } = between(d, alpha);
        const fwd = norm(rotateFromTo(d.forward, d.up, up)), right = cross(fwd, up);
        dummy.matrix.makeBasis(v3(right), v3(up), v3(scale(fwd, -1))).setPosition(v3(pos));
        dummy.matrixAutoUpdate = false;
      }

      let i = 0;
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

      renderer.render(scene, camera);
    },
  };
}
