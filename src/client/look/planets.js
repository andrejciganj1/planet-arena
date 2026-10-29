// The sun, planets and moons as faceted spheres, the giant's ring and the orbit lines.
import * as THREE from "three";
import { posesAt } from "../../sim/system.js";
import { v3, Y } from "./common.js";

// A faceted sphere whose faces vary a little in shade, so running across it shows motion.
export function sphereMesh(body, rand) {
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

// A flat ring like Saturn's, riding on its planet (planets don't spin). Looks only.
export function planetRing(body) {
  const { inner, outer, tilt } = body.ring;
  const geo = new THREE.RingGeometry(body.radius * inner, body.radius * outer, 96);
  const mat = new THREE.MeshBasicMaterial({ color: 0xcbb8f0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2 + (tilt * Math.PI) / 180;
  return ring;
}

// Faint orbit rings, so you can see where a planet will come round. A moon's ring rides on its planet.
// A comet's ellipse is sampled from the simulation's own poses, so the line is exactly its path.
// Returns [{ ring, around }]; the caller adds them to the scene and moves each with its `around` body.
export function orbitLines(system) {
  const rings = [];
  for (const b of system.bodies.filter((b) => b.orbit)) {
    const pts = [];
    if (b.orbit.peri) {
      for (let i = 0; i <= 256; i++) pts.push(v3(posesAt(system, (i / 256) * b.orbit.period)[b.id].pos));
    } else {
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * 2 * Math.PI;
        pts.push(new THREE.Vector3(b.orbit.radius * Math.cos(a), 0, b.orbit.radius * Math.sin(a)));
      }
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x39406a }));
    rings.push({ ring, around: b.orbit.around });
  }
  return rings;
}
