// The sky behind everything: a few nebulas and a distant galaxy, painted once at load by a shader into a cube
// map, with the field of stars drawn in front. Painting it here costs no download (a smooth image of nebulas
// compresses badly) and a few milliseconds of GPU once; after that the background is one texture lookup.
import * as THREE from "three";
import { LOOK } from "../../tuning.js";
import { NOISE_GLSL } from "./common.js";
import { skyPainted } from "./skycheck.js";

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

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Linear colours out; the cube map is sRGB, so its darks keep their precision.
const fragmentShader = (nebulaCount) => /* glsl */ `
#define NEB ${nebulaCount}
uniform vec3 nebDir[NEB], nebA[NEB], nebB[NEB];
uniform float nebSize[NEB], nebSeed[NEB];
uniform vec3 galDir, galU, galV;
uniform float galSize, galSquash, stars;
varying vec3 vDir;
${NOISE_GLSL}

vec3 nebulas(vec3 d) {
  // One warped field shared by all, so they read as parts of one sky; each nebula masks its own patch.
  vec3 w = vec3(fbm(d * 1.8, 4), fbm(d * 1.8 + 5.2, 4), fbm(d * 1.8 + 9.7, 4));
  vec3 q = d * 2.6 + w * 1.4;
  float cloud = fbm(q, 7);
  float fil = 1.0 - abs(fbm(q * 1.9 + 3.0, 6)); // ridges: bright filaments
  fil = fil * fil * fil * fil;
  vec3 col = vec3(0.0);
  for (int i = 0; i < NEB; i++) {
    float ang = acos(clamp(dot(d, nebDir[i]), -1.0, 1.0)) / nebSize[i];
    float edge = ang + 0.55 * fbm(d * 2.2 + nebSeed[i] * 7.1, 5); // ragged edges
    float m = exp(-edge * edge * 2.2);
    float dens = m * smoothstep(-0.35, 0.55, cloud + 0.35 * m);
    float t = clamp(0.5 + 1.3 * fbm(q * 1.3 + nebSeed[i] * 3.7, 4), 0.0, 1.0);
    vec3 c = mix(nebA[i], nebB[i], t);
    col += c * dens * (0.35 + 1.4 * fil * m) + c * m * m * 0.12;
  }
  // Dark dust lanes cut across the glow.
  float dust = fbm(d * 4.0 + w * 0.9 + 20.0, 6);
  return col * (1.0 - 0.8 * smoothstep(0.0, 0.3, dust));
}

vec3 galaxy(vec3 d) {
  float z = dot(d, galDir);
  if (z <= 0.0) return vec3(0.0);
  vec2 p = vec2(dot(d, galU), dot(d, galV) / galSquash) / z / galSize;
  float r = length(p);
  if (r > 1.3) return vec3(0.0);
  float a = atan(p.y, p.x);
  float arms = pow(0.5 + 0.5 * cos(2.0 * (a - 2.4 * log(r + 0.04))), 2.0);
  float clumps = 0.55 + 0.9 * max(0.0, noise3(vec3(p * 9.0, 1.0)));
  float lane = smoothstep(0.55, 0.9, 0.5 + 0.5 * cos(2.0 * (a - 2.4 * log(r + 0.04)) + 0.9));
  float disk = exp(-r * 3.4) * smoothstep(1.25, 0.7, r);
  float core = exp(-r * r * 70.0);
  vec3 col = vec3(0.38, 0.5, 0.9) * disk * arms * clumps * (1.0 - 0.6 * lane)
           + vec3(0.55, 0.3, 0.45) * disk * arms * max(0.0, noise3(vec3(p * 16.0, 4.0))) * 0.6
           + vec3(0.45, 0.38, 0.3) * disk * 0.35
           + vec3(1.0, 0.85, 0.6) * core * 1.1;
  return col * 0.45;
}

float hash1(vec3 p) {
  p = mod(p, 289.0);
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0015, 0.0018, 0.004); // the old flat backdrop, as the floor
  col += nebulas(d) * 0.22;
  col += galaxy(d);
  // Faint distant stars, one texel each, a few more inside the nebulas.
  float h = hash1(floor(d * 900.0));
  if (h > 1.0 - stars) {
    float b = (h - 1.0 + stars) / stars;
    col += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash1(floor(d * 900.0) + 7.0)) * b * b * 0.06;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// The plain dark backdrop the sky falls back to when it can't be painted.
export const PLAIN_SPACE = 0x05060d;

// Paints the sky with `renderer` into a cube map and returns the render target (its texture is for
// scene.background), or null after one warning if it couldn't: the caller then keeps plain space.
// skip: draws nothing, so the check below sees a failed bake (?debug&nosky, to try the fallback).
export function nebulaSky(renderer, { cfg = LOOK.sky, skip = false } = {}) {
  const gl = renderer.getContext();
  let rt = null, error = null, pixel = null;
  gl.getError(); // start from no error
  try {
    rt = new THREE.WebGLCubeRenderTarget(cfg.size, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: false });
    paint(renderer, rt, cfg, skip);
    pixel = new Uint8Array(4);
    renderer.readRenderTargetPixels(rt, cfg.size >> 1, cfg.size >> 1, 1, 1, pixel, 0);
  } catch (e) {
    error = e;
  }
  const glError = gl.getError();
  if (skyPainted({ error, pixel, glError })) return rt;
  console.warn(`look: the sky could not be painted (${error?.message ?? (glError ? `WebGL error ${glError}` : "nothing drew")}), plain space instead`);
  try {
    rt?.dispose();
  } catch {} // a broken context may refuse even this; nothing more to free
  return null;
}

function paint(renderer, rt, cfg, skip) {
  const lin = (hex) => new THREE.Color(hex); // three keeps colours linear
  const dir = (a) => new THREE.Vector3(...a).normalize();
  const g = cfg.galaxy, gd = dir(g.dir);
  const gu = new THREE.Vector3().crossVectors(gd, Math.abs(gd.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  gu.applyAxisAngle(gd, (g.turn * Math.PI) / 180);
  const gv = new THREE.Vector3().crossVectors(gd, gu);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      nebDir: { value: cfg.nebulas.map((n) => dir(n.dir)) },
      nebA: { value: cfg.nebulas.map((n) => lin(n.colors[0])) },
      nebB: { value: cfg.nebulas.map((n) => lin(n.colors[1])) },
      nebSize: { value: cfg.nebulas.map((n) => n.size) },
      nebSeed: { value: cfg.nebulas.map((n) => n.seed) },
      galDir: { value: gd }, galU: { value: gu }, galV: { value: gv },
      galSize: { value: g.size }, galSquash: { value: Math.cos((g.tilt * Math.PI) / 180) },
      stars: { value: cfg.stars },
    },
    vertexShader, fragmentShader: fragmentShader(cfg.nebulas.length), side: THREE.BackSide, depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene(), box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  if (!skip) scene.add(box);
  new THREE.CubeCamera(0.1, 10, rt).update(renderer, scene);
  box.geometry.dispose();
  mat.dispose();
}
