// Collision against the bodies: spheres (sun, planets, moons) and the comets' lumpy shapes (shape.js). Tests
// run the same in Node and the browser, no physics engine needed.
import { add, sub, scale, len, norm, dot } from "./vec.js";
import { radiusAt, normalAt, nearestDir } from "./shape.js";

// Beyond this many metres outside a shaped body's bounding sphere, surfaceInfo gives the sphere's gap (less
// than the real one) and skips the lumps: nothing that far off needs better (gravity's hold, contacts and
// asteroid clearance all look within a few metres).
export const FAR = 8;
// Within this many metres of a shaped body's surface one step finds the nearest point; beyond, a search does.
const NEAR = 0.3;

// The gap from p to a body's surface (m, negative inside), the outward normal there and the surface point
// in p's direction from the centre. A shaped body's gap is measured along its normal, near enough for
// contacts.
export function surfaceInfo(body, pose, p) {
  const c = pose.pos;
  const v = sub(p, c);
  const l = len(v);
  const u = l > 1e-12 ? scale(v, 1 / l) : [0, 1, 0];
  if (!body.shape || l - body.radius > FAR) return { dist: l - body.radius, normal: u, point: add(c, scale(u, body.radius)) };
  // Close to the surface: straight in, then once more from the foot of the normal from p, all but exact on
  // lumps this gentle. Further out the nearest point can be well round from straight in (a dent's walls are
  // nearer than its floor), so it is searched for (shape.js nearestDir).
  const r0 = radiusAt(body, u);
  let normal = normalAt(body, u, r0), w = norm(sub(v, scale(normal, (l - r0) * dot(normal, u))));
  let r = radiusAt(body, w);
  normal = normalAt(body, w, r);
  let gap = dot(sub(v, scale(w, r)), normal);
  if (gap > NEAR) {
    w = nearestDir(body, v, w);
    r = radiusAt(body, w);
    normal = normalAt(body, w, r);
    gap = len(sub(v, scale(w, r)));
  }
  return { dist: gap, normal, point: add(c, scale(w, r)) };
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

// First f in 0..1 where the segment a to b comes within r of a shaped body's surface (along the line from its
// centre); 0 if a starts there. The sphere round the body says where to start; then it steps along by half
// the gap (the lumps are gentle, so the gap never overstates the distance twofold) and closes in on the
// crossing by halving.
function segmentHitsShape(a, b, body, c, r) {
  const f0 = segmentHitsSphere(a, b, c, body.radius + r);
  if (f0 === null) return null;
  const d = sub(b, a), l = len(d);
  const gapAt = (f) => {
    const v = sub(add(a, scale(d, f)), c), lv = len(v);
    return lv - r - (lv > 1e-12 ? radiusAt(body, scale(v, 1 / lv)) : 0);
  };
  let f = f0, g = gapAt(f);
  if (g <= 0) return f;
  if (l < 1e-12) return null;
  for (let i = 0; i < 400 && f < 1; i++) {
    const next = Math.min(1, f + Math.max(0.5 * g, 0.005) / l);
    g = gapAt(next);
    if (g <= 0) {
      let lo = f, hi = next;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (gapAt(mid) <= 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    f = next;
  }
  return null;
}

export function segmentHit(system, poses, a, b, r = 0) {
  let best = null;
  for (const body of system.bodies) {
    const pose = poses[body.id];
    const f = body.shape ? segmentHitsShape(a, b, body, pose.pos, r) : segmentHitsSphere(a, b, pose.pos, body.radius + r);
    if (f !== null && (!best || f < best.f)) best = { id: body.id, f };
  }
  if (!best) return null;
  const point = add(a, scale(sub(b, a), best.f));
  const body = system.byId[best.id];
  return { ...best, point, normal: norm(surfaceInfo(body, poses[best.id], point).normal) };
}
