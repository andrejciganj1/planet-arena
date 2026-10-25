// Gravity shaped for play, not physics: each body pulls with its full `g` out to `reach` from its core,
// then falls off with the square of distance. Near a surface its own body wins; between bodies the sun's
// pull takes over anything that has lost its footing.
import { sub, add, scale, len, norm } from "./vec.js";

// The point of a body's core closest to p: the centre for spheres, the mid-plane rectangle for the
// station, so the station pulls straight into its deck right out to the corners.
export function corePoint(body, pose, p) {
  if (body.kind !== "station") return pose.pos;
  const [w, , d] = body.size;
  const c = pose.pos;
  return [Math.min(Math.max(p[0], c[0] - w / 2), c[0] + w / 2), c[1], Math.min(Math.max(p[2], c[2] - d / 2), c[2] + d / 2)];
}

export function bodyPull(body, pose, p) {
  const v = sub(corePoint(body, pose, p), p);
  const d = len(v);
  if (d < 1e-9) return [0, 0, 0];
  const g = d <= body.reach ? body.g : body.g * (body.reach / d) ** 2;
  return scale(v, g / d);
}

export function gravityAt(system, poses, p, onlyId = null) {
  if (onlyId) return bodyPull(system.byId[onlyId], poses[onlyId], p);
  let acc = [0, 0, 0];
  for (const b of system.bodies) acc = add(acc, bodyPull(b, poses[b.id], p));
  return acc;
}

export function dominantBody(system, poses, p) {
  let best = null, bestG = -1;
  for (const b of system.bodies) {
    const g = len(bodyPull(b, poses[b.id], p));
    if (g > bestG) (best = b.id), (bestG = g);
  }
  return best;
}
