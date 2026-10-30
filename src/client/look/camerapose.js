// The third-person camera and its crosshair, pure (no three.js, so the tests check them). The game's aim never
// changes: shots leave the eye along the view. The camera sits over the shoulder, and the crosshair is drawn
// where that line from the eye lands, so it always shows where the shot goes.
import { LOOK } from "../../tuning.js";
import { add, sub, scale, norm, cross } from "../../sim/vec.js";
import { segmentHit } from "../../sim/collide.js";
import { segmentHitsPlayer } from "../../sim/entity.js";

// Where the camera sits for the eye at `eye` looking along `dir` with `up`: back, right and up of it, pulled in
// along the way there when a body is in the way, so it never goes inside one.
export function thirdCamera(eye, dir, up, system, poses, cfg = LOOK.third) {
  const right = norm(cross(dir, up));
  const target = add(add(sub(eye, scale(dir, cfg.back)), scale(right, cfg.side)), scale(up, cfg.lift));
  const hit = segmentHit(system, poses, eye, target, cfg.pad);
  return hit ? hit.point : target;
}

// Where a shot from `eye` along `dir` lands: the first body or player (not p) within range, else range out.
export function aimPoint(world, p, eye, dir, range = LOOK.third.range) {
  const end = add(eye, scale(dir, range));
  let f = segmentHit(world.system, world.poses, eye, end)?.f ?? 1;
  for (const e of Object.values(world.entities)) {
    if (e === p || !e.alive) continue;
    const g = segmentHitsPlayer(eye, end, e.pos, e.up);
    if (g !== null && g < f) f = g;
  }
  return add(eye, scale(sub(end, eye), f));
}
