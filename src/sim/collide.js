// Collision against the only shapes the world has: spheres (sun, planets, moon) and one axis-aligned
// box (the station). Closest-point tests run the same in Node and the browser, no physics engine needed.
import { add, sub, scale, len, norm, dot } from "./vec.js";

// Signed distance from a body's surface to p, the outward normal there, and the closest surface point.
export function surfaceInfo(body, pose, p) {
  const c = pose.pos;
  if (body.kind !== "station") {
    const v = sub(p, c);
    const l = len(v);
    const normal = l > 1e-12 ? scale(v, 1 / l) : [0, 1, 0];
    return { dist: l - body.radius, normal, point: add(c, scale(normal, body.radius)) };
  }
  // Axis-aligned box, written out per axis: this runs in every physics step.
  const hx = body.size[0] / 2, hy = body.size[1] / 2, hz = body.size[2] / 2;
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
  const qx = Math.abs(dx) - hx, qy = Math.abs(dy) - hy, qz = Math.abs(dz) - hz;
  if (qx > 0 || qy > 0 || qz > 0) {
    const point = [c[0] + Math.min(Math.max(dx, -hx), hx), c[1] + Math.min(Math.max(dy, -hy), hy), c[2] + Math.min(Math.max(dz, -hz), hz)];
    const v = sub(p, point);
    const l = len(v);
    return { dist: l, normal: scale(v, 1 / l), point };
  }
  // Inside: leave through the nearest face.
  const i = qx >= qy && qx >= qz ? 0 : qy >= qz ? 1 : 2;
  const q = [qx, qy, qz][i];
  const sign = p[i] >= c[i] ? 1 : -1;
  const normal = [0, 0, 0];
  normal[i] = sign;
  const point = [...p];
  point[i] = c[i] + sign * body.size[i] / 2;
  return { dist: q, normal, point };
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

// Slab test against an axis-aligned box grown by r on every side.
function segmentHitsBox(a, b, c, half, r) {
  const d = sub(b, a);
  let lo = 0, hi = 1;
  for (let i = 0; i < 3; i++) {
    const min = c[i] - half[i] - r, max = c[i] + half[i] + r;
    if (Math.abs(d[i]) < 1e-12) {
      if (a[i] < min || a[i] > max) return null;
      continue;
    }
    let t0 = (min - a[i]) / d[i], t1 = (max - a[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    if (lo > hi) return null;
  }
  return lo;
}

export function segmentHit(system, poses, a, b, r = 0) {
  let best = null;
  for (const body of system.bodies) {
    const pose = poses[body.id];
    const f = body.kind === "station"
      ? segmentHitsBox(a, b, pose.pos, body.size.map((s) => s / 2), r)
      : segmentHitsSphere(a, b, pose.pos, body.radius + r);
    if (f !== null && (!best || f < best.f)) best = { id: body.id, f };
  }
  if (!best) return null;
  const point = add(a, scale(sub(b, a), best.f));
  const body = system.byId[best.id];
  return { ...best, point, normal: norm(surfaceInfo(body, poses[best.id], point).normal) };
}
