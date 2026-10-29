// How much of the sun is in sight from an eye, 0..1: the share of a few points across its disc that no body
// covers. Every body is a sphere, so a ray test is exact enough, and cheap enough for every frame. Pure, so
// it runs under node tests.
import { sub, add, scale, dot, cross, norm, len } from "../../sim/vec.js";

// Points on the disc in sun radii: the centre and two rings, so a planet edge crossing it fades the glow.
const DISC = [[0, 0]];
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4;
  DISC.push([0.45 * Math.cos(a), 0.45 * Math.sin(a)], [0.85 * Math.cos(a + 0.4), 0.85 * Math.sin(a + 0.4)]);
}

// Does the segment from `from` along unit `u` for `l` metres pass through the sphere?
function covers(from, u, l, { pos, radius }) {
  const oc = sub(from, pos), b = dot(oc, u), c = dot(oc, oc) - radius * radius;
  if (c < 0) return true;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < l;
}

//   blockers: [{ pos, radius }], every body but the sun
export function sunInSight(eye, sun, radius, blockers) {
  const to = sub(sun, eye), d = len(to);
  if (d <= radius) return 1;
  const f = scale(to, 1 / d);
  const a = norm(cross(f, Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), b = cross(f, a);
  let seen = 0;
  for (const [x, y] of DISC) {
    const at = add(sun, add(scale(a, x * radius), scale(b, y * radius)));
    const ray = sub(at, eye), l = len(ray), u = scale(ray, 1 / l);
    if (!blockers.some((s) => covers(eye, u, l, s))) seen++;
  }
  return seen / DISC.length;
}
