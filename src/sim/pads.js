// Jump pads: fixed directions on their bodies (nothing spins), launching whoever steps on them.
import { add, scale } from "./vec.js";

// Where a pad sits: out from the body's centre along its direction, on the surface.
export function padPos(world, pad, poses) {
  const body = world.system.byId[pad.body];
  const c = poses[pad.body].pos;
  if (body.kind !== "station") return add(c, scale(pad.dir, body.radius));
  const t = Math.min(...[0, 1, 2].map((i) => (Math.abs(pad.dir[i]) > 1e-9 ? body.size[i] / 2 / Math.abs(pad.dir[i]) : Infinity)));
  return add(c, scale(pad.dir, t));
}
