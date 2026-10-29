// The sky behind everything: for now a field of stars.
import * as THREE from "three";

export function starfield(rand) {
  const pos = [];
  for (let i = 0; i < 2500; i++) {
    const u = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(1800);
    pos.push(u.x, u.y, u.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false }));
}
