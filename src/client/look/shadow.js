// Shadows without shadow maps: every body is a sphere and the sun is a big round light, so how much of the
// sun a sphere hides from a point is a little geometry, done per pixel in the planet shaders. The same maths
// in JS (pure, no three.js) is what the tests check; keep the two in step. Also where a figure's soft blob
// shadow lies on the ground.
import { LOOK } from "../../tuning.js";

// How much sunlight reaches point p past one sphere (centre c, radius r), 0 dark to 1 full: the share of the
// sun's disc (centre sun, radius sunR) the sphere's disc leaves uncovered, as seen from p. The overlap of two
// discs is eased with a smoothstep between "just touching" and "one inside the other", which keeps the soft
// edge and costs no more than a few dot products.
export function sphereShadow(p, sun, sunR, c, r) {
  const sx = sun[0] - p[0], sy = sun[1] - p[1], sz = sun[2] - p[2];
  const cx = c[0] - p[0], cy = c[1] - p[1], cz = c[2] - p[2];
  const ds = Math.hypot(sx, sy, sz), dc = Math.hypot(cx, cy, cz);
  if (dc <= r) return 0;
  if (dc >= ds) return 1; // beyond the sun
  const as = Math.asin(Math.min(sunR / ds, 1)), ao = Math.asin(r / dc);
  const theta = Math.acos(Math.max(-1, Math.min(1, (sx * cx + sy * cy + sz * cz) / (ds * dc))));
  const full = Math.min(1, (ao / as) ** 2);
  return 1 - full * (1 - smoothstep(Math.abs(as - ao), as + ao, theta));
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(b - a, 1e-9)));
  return t * t * (3 - 2 * t);
}

// The GLSL twin of sphereShadow.
export const SHADOW_GLSL = /* glsl */ `
float sphereShadow(vec3 p, vec3 sun, float sunR, vec3 c, float r) {
  vec3 s = sun - p, o = c - p;
  float ds = length(s), dc = length(o);
  if (dc <= r) return 0.0;
  if (dc >= ds) return 1.0;
  float sa = asin(min(sunR / ds, 1.0)), oa = asin(r / dc);
  float theta = acos(clamp(dot(s, o) / (ds * dc), -1.0, 1.0));
  float full = min(1.0, (oa / sa) * (oa / sa));
  return 1.0 - full * (1.0 - smoothstep(abs(sa - oa), sa + oa, theta));
}
`;

// The soft dark patch under something near a body's surface: { at, radius, strength } with `at` on the
// nearest surface straight below, or null when it is too high to cast one. It widens and fades as the thing
// rises, as a real shadow under a big soft light would.
//   pos: the thing's lowest point; size: its radius in m; bodies: [{ pos, radius }]; out: filled and returned
//   (a new object if not given), so a caller can reuse its own every frame
export function blobUnder(pos, size, bodies, cfg = LOOK.planets.blob, out = { at: [0, 0, 0], radius: 0, strength: 0 }) {
  let best = null, gap = Infinity;
  for (const b of bodies) {
    const g = Math.hypot(pos[0] - b.pos[0], pos[1] - b.pos[1], pos[2] - b.pos[2]) - b.radius;
    if (g < gap) (gap = g), (best = b);
  }
  if (!best) return null;
  const h = Math.max(0, gap);
  if (h >= cfg.fade) return null;
  const d = Math.hypot(pos[0] - best.pos[0], pos[1] - best.pos[1], pos[2] - best.pos[2]) || 1;
  const k = best.radius / d;
  for (let i = 0; i < 3; i++) out.at[i] = best.pos[i] + (pos[i] - best.pos[i]) * k;
  out.radius = size * (1 + h * cfg.spread);
  out.strength = cfg.strength * (1 - h / cfg.fade) ** 2;
  return out;
}
