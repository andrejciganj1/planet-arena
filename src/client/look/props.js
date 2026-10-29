// The things around the bodies: pickups, pads and their cue path, the hook's rope, comet tails, the
// asteroid belt and the flying asteroids.
import * as THREE from "three";
import { BELT, ASTEROID, ROCK_LOOK } from "../../tuning.js";
import { v3, Y } from "./common.js";
import { add, scale } from "../../sim/vec.js";
import { WEAPON_COLORS } from "./weapons.js";

// A pickup's look: health a white box with a red cross, fuel an orange can, a weapon a long bar and ammo
// a small box in the weapon's colour. The same shape as a faint wireframe marks a spot waiting to refill.
export function pickupMesh(pk, wire) {
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

// A pad: a disk on the ground (n its up) and an arrow along its launch direction. The one material is
// recoloured by the cue each frame.
export function padMesh(n, dir) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xe0443e });
  const g = new THREE.Group();
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.25, 20), mat);
  disk.quaternion.setFromUnitVectors(Y, v3(n));
  disk.position.copy(v3(scale(n, 0.1)));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 10), mat);
  arrow.quaternion.setFromUnitVectors(Y, v3(dir));
  arrow.position.copy(v3(add(scale(n, 0.5), scale(dir, 0.5))));
  g.add(disk, arrow);
  return { g, mat };
}

// The nearest pad's cue: where a launch from it goes.
export function cuePath() {
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 1024), 3));
  // Dashed, so a cue can't be mistaken for an orbit line.
  const pathMat = new THREE.LineDashedMaterial({ color: 0x3ee05a, dashSize: 1, gapSize: 0.7 });
  const path = new THREE.Line(pathGeo, pathMat);
  path.frustumCulled = false;
  return { path, pathGeo, pathMat };
}

// The rope, from the hand to where the hook caught.
export function ropeLine() {
  const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd9d2c0 }));
  rope.frustumCulled = false;
  return { rope, ropeGeo };
}

// A comet's tail: an open cone, its base at the comet and its tip pointing away (set per frame).
export function cometTail() {
  const geo = new THREE.ConeGeometry(1, 1, 12, 1, true);
  geo.translate(0, 0.5, 0); // wide end at the comet, tip out along +y
  const mat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// The asteroid belt: one instanced mesh of tumbling rocks, turning round the sun the way the planets go.
// Looks only, so it lives here and not in the simulation.
export function asteroidBelt(rand) {
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

// Flying asteroids: a dark rough rock in a faint orange shell, and a fading streak of where it has been.
// Returns a maker of one rock's { mesh, line }; the caller keeps them per rock id.
export function flyingRocks() {
  const rockGeo = new THREE.DodecahedronGeometry(ASTEROID.radius, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: ROCK_LOOK.rock, emissive: ROCK_LOOK.hot, emissiveIntensity: 0.35, flatShading: true });
  const glowGeo = new THREE.SphereGeometry(ASTEROID.radius * ROCK_LOOK.glow, 12, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: ROCK_LOOK.hot, transparent: true, opacity: ROCK_LOOK.glowOpacity, depthWrite: false });
  return () => {
    const mesh = new THREE.Mesh(rockGeo, rockMat);
    mesh.add(new THREE.Mesh(glowGeo, glowMat));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * ROCK_LOOK.trail), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3 * ROCK_LOOK.trail), 3));
    // Points, not a line: a line is one pixel wide and vanishes at distance. Close together they read as a streak.
    const line = new THREE.Points(geo, new THREE.PointsMaterial({ size: ROCK_LOOK.trailSize, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    line.frustumCulled = false;
    return { mesh, line };
  };
}
