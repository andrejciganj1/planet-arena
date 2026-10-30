// Small helpers every look module shares.
import * as THREE from "three";

export const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const Y = new THREE.Vector3(0, 1, 0);

// One soft round light, shared by every halo.
let haloTexture = null;
export function haloMap() {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d"), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (haloTexture = new THREE.CanvasTexture(c));
}

// Deterministic randomness, so every load looks the same.
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// GLSL gradient noise in 3D, about -1..1, and its sum over octaves. Inputs are wrapped so the sine hash keeps
// its precision far from the origin.
export const NOISE_GLSL = /* glsl */ `
vec3 hash3(vec3 p) {
  p = mod(p, 289.0);
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453) * 2.0 - 1.0;
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 e = vec3(1.0, 0.0, 0.0);
  return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + e.xyy), f - e.xyy), u.x),
                 mix(dot(hash3(i + e.yxy), f - e.yxy), dot(hash3(i + e.xxy), f - e.xxy), u.x), u.y),
             mix(mix(dot(hash3(i + e.yyx), f - e.yyx), dot(hash3(i + e.xyx), f - e.xyx), u.x),
                 mix(dot(hash3(i + e.yxx), f - e.yxx), dot(hash3(i + e.xxx), f - e.xxx), u.x), u.y), u.z) * 1.6;
}
float fbm(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    sum += amp * noise3(p);
    p = p * 2.03 + vec3(1.7, -3.1, 2.3);
    amp *= 0.5;
  }
  return sum;
}
`;
