// Lag compensation: where the shooter saw a target when they pulled the trigger. The server keeps a short
// history of every entity and rewinds hits to the shooter's view delay.
import { add, sub, scale, lerp, norm } from "./vec.js";
import { hitCentre } from "./entity.js";

// Called at the end of each world step. Planets are not stored: they are scripted from the clock, so a
// grounded entity is kept as an offset from its body.
export function record(world) {
  const { NET } = world.tuning;
  const ents = {};
  for (const e of Object.values(world.entities)) {
    if (!e.alive) continue;
    ents[e.id] = {
      pos: [...e.pos], up: [...e.up], groundId: e.groundId, rel: e.groundId ? sub(e.pos, world.poses[e.groundId].pos) : null,
    };
  }
  world.history.push({ t: world.t, ents });
  while (world.history[0].t < world.t - NET.history) world.history.shift();
}

// Where a record's entity is drawn: grounded ones ride their body at its current pose (the browser draws
// bodies at its own, later time), the rest are where they were.
export const placeRec = (rec, poses) =>
  rec.groundId && poses[rec.groundId] ? add(poses[rec.groundId].pos, rec.rel) : rec.pos;

// The hit centre of e as the shooter saw it, `lag` seconds ago (capped), placed against the current poses.
export function seenCentre(world, e, lag) {
  const { NET, PLAYER } = world.tuning;
  const h = world.history;
  if (!(lag > 0) || !h?.length) return hitCentre(e);
  const at = world.t - Math.min(lag, NET.maxLag);
  let i = h.length - 1;
  while (i > 0 && h[i].t > at) i--;
  const a = h[i].ents[e.id], b = (h[i + 1] || h[i]).ents[e.id];
  if (!a && !b) return hitCentre(e);
  let rec = b || a;
  if (a && b && a !== b) {
    const k = Math.min(1, Math.max(0, (at - h[i].t) / (h[i + 1].t - h[i].t)));
    // Across a change of body the later record is used whole; lerping would swing through space.
    if (a.groundId === b.groundId) {
      const up = norm(lerp(a.up, b.up, k));
      rec = { groundId: a.groundId, up, pos: lerp(a.pos, b.pos, k), rel: a.groundId ? lerp(a.rel, b.rel, k) : null };
    }
  } else if (a && !b) rec = a;
  return add(placeRec(rec, world.poses), scale(rec.up, PLAYER.radius));
}
