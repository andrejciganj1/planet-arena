// The shape of a body: a sphere of `radius`, or, with `shape`, a lumpy potato inside that sphere (the
// comets). Every direction from the centre meets the surface once (no overhangs), at radiusAt(body, u), so
// the sphere still bounds it for quick tests. The potato is a squashed sphere (`squash`: its half-axes as
// shares of the radius, the largest 1) with `dents` round hollows pressed in, each `depth` (a share of the
// radius) and `width` (1 - cos of about its angular size) from a range, laid out from `seed` the same way on
// every machine. Bodies don't turn, so the shape is fixed in the world's axes.
import { dot, norm, add, scale, cross } from "./vec.js";

// A small seeded generator, so the dents come out the same in the browser and on the server.
function generator(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const dentsOf = new WeakMap(); // body -> [{ at (unit), depth, width }]
function dents(body) {
  let list = dentsOf.get(body);
  if (list) return list;
  const { seed, dents: n, depth, width } = body.shape, next = generator(seed);
  const pick = ([lo, hi]) => lo + (hi - lo) * next();
  list = Array.from({ length: n }, () => {
    const z = 2 * next() - 1, a = 2 * Math.PI * next(), s = Math.sqrt(1 - z * z);
    return { at: [s * Math.cos(a), s * Math.sin(a), z], depth: pick(depth), width: pick(width) };
  });
  dentsOf.set(body, list);
  return list;
}

// m from the centre to the surface along the unit direction u.
export function radiusAt(body, u) {
  if (!body.shape) return body.radius;
  const [sx, sy, sz] = body.shape.squash;
  let r = body.radius / Math.sqrt((u[0] / sx) ** 2 + (u[1] / sy) ** 2 + (u[2] / sz) ** 2);
  let k = 1;
  for (const d of dents(body)) k -= d.depth * Math.exp((dot(u, d.at) - 1) / d.width);
  return r * k;
}

// Two unit directions square to u and to each other.
export function tangents(u) {
  const t1 = norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [t1, cross(u, t1)];
}

// The outward unit normal where the direction u meets the surface (r: radiusAt(body, u), if known): the
// radius's slope either way across tilts it from u.
export function normalAt(body, u, r = radiusAt(body, u)) {
  if (!body.shape) return u;
  const [t1, t2] = tangents(u), e = 1e-4;
  const slope = (t) => (radiusAt(body, norm(add(u, scale(t, e)))) - radiusAt(body, norm(add(u, scale(t, -e))))) / (2 * e * r);
  return norm(add(u, add(scale(t1, -slope(t1)), scale(t2, -slope(t2)))));
}
