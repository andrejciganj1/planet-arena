// Gravity shaped for play, not physics: each body pulls with its full `g` out to `reach` from its core,
// then falls off with the square of distance. Near a surface its own body wins; between bodies the sun's
// pull takes over anything that has lost its footing.
//
// Hold: within `hold` metres of a body's surface only that body pulls, and the others fade back in over
// the next `hold` metres. Scripted planets don't fall towards the sun the way real ones would, so without
// this the sun's full pull would tear an ordinary jump off a small planet.
import { sub, add, scale, len, norm } from "./vec.js";
import { surfaceInfo } from "./collide.js";

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

// How much the bodies other than the holder pull at p: 0 deep in a hold, 1 out in space.
function holdOf(system, poses, p) {
  let holder = null, alt = Infinity;
  for (const b of system.bodies) {
    if (!(b.hold > 0)) continue;
    const a = surfaceInfo(b, poses[b.id], p).dist;
    if (a < 2 * b.hold && a < alt) (holder = b), (alt = a);
  }
  if (!holder) return { holder: null, w: 1 };
  return { holder, w: Math.min(1, Math.max(0, (alt - holder.hold) / holder.hold)) };
}

// Each body's shaped pull at p.
function pulls(system, poses, p) {
  const { holder, w } = holdOf(system, poses, p);
  return system.bodies.map((b) => {
    const v = bodyPull(b, poses[b.id], p);
    return { id: b.id, v: !holder || b === holder ? v : scale(v, w) };
  });
}

export function gravityAt(system, poses, p, onlyId = null) {
  if (onlyId) return bodyPull(system.byId[onlyId], poses[onlyId], p);
  return shapedGravity(system, poses, p).acc;
}

// The body with the strongest shaped pull: what you are falling to.
export function dominantBody(system, poses, p) {
  return shapedGravity(system, poses, p).dominant;
}

// Both at once, for the physics step that needs both.
export function shapedGravity(system, poses, p) {
  let acc = [0, 0, 0], dominant = null, bestG = -1;
  for (const { id, v } of pulls(system, poses, p)) {
    acc = add(acc, v);
    const g = len(v);
    if (g > bestG) (dominant = id), (bestG = g);
  }
  return { acc, dominant };
}
