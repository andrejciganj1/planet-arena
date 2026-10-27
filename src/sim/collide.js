// Collision against the only shape the world has: spheres (sun, planets, moon). Closest-point tests run
// the same in Node and the browser, no physics engine needed.
import { add, sub, scale, len, norm, dot } from "./vec.js";

// Signed distance from a body's surface to p, the outward normal there, and the closest surface point.
export function surfaceInfo(body, pose, p) {
  const c = pose.pos;
  const v = sub(p, c);
  const l = len(v);
  const normal = l > 1e-12 ? scale(v, 1 / l) : [0, 1, 0];
  return { dist: l - body.radius, normal, point: add(c, scale(normal, body.radius)) };
}

export function sphereContacts(system, poses, centre, r) {
  const out = [];
  for (const b of system.bodies) {
    const s = surfaceInfo(b, poses[b.id], centre);
    if (s.dist < r) out.push({ id: b.id, depth: r - s.dist, normal: s.normal });
  }
  return out;
}

// First f in 0..1 where the segment a to b meets the sphere (c, r); 0 if a starts inside.
export function segmentHitsSphere(a, b, c, r) {
  const d = sub(b, a), m = sub(a, c);
  const cc = dot(m, m) - r * r;
  if (cc <= 0) return 0;
  const aa = dot(d, d), bb = dot(m, d);
  if (aa < 1e-18 || bb > 0) return null;
  const disc = bb * bb - aa * cc;
  if (disc < 0) return null;
  const f = (-bb - Math.sqrt(disc)) / aa;
  return f <= 1 ? f : null;
}

export function segmentHit(system, poses, a, b, r = 0) {
  let best = null;
  for (const body of system.bodies) {
    const pose = poses[body.id];
    const f = segmentHitsSphere(a, b, pose.pos, body.radius + r);
    if (f !== null && (!best || f < best.f)) best = { id: body.id, f };
  }
  if (!best) return null;
  const point = add(a, scale(sub(b, a), best.f));
  const body = system.byId[best.id];
  return { ...best, point, normal: norm(surfaceInfo(body, poses[best.id], point).normal) };
}
