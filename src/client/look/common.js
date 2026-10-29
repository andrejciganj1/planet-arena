// Small helpers every look module shares.
import * as THREE from "three";

export const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const Y = new THREE.Vector3(0, 1, 0);

// Deterministic randomness, so every load looks the same.
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
