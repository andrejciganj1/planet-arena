// Lag compensation: where the shooter saw a target when they pulled the trigger. The server keeps a short
// history of every entity and asteroid and rewinds hits to the shooter's view delay.
import { add, sub, lerp, norm } from "./vec.js";

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
  const rocks = {};
  for (const r of world.asteroids || []) rocks[r.id] = [...r.pos];
  world.history.push({ t: world.t, ents, rocks });
  while (world.history[0].t < world.t - NET.history) world.history.shift();
}

// Where a record's entity is drawn: grounded ones ride their body at its current pose (the browser draws
// bodies at its own, later time), the rest are where they were.
export const placeRec = (rec, poses) =>
  rec.groundId && poses[rec.groundId] ? add(poses[rec.groundId].pos, rec.rel) : rec.pos;

// The feet and up of e as the shooter saw them, `lag` seconds ago (capped), placed against the current
// poses. Callers build the hit spheres from it.
export function seenPose(world, e, lag) {
  const { NET } = world.tuning;
  const now = { pos: e.pos, up: e.up };
  const h = world.history;
  if (!(lag > 0) || !h?.length) return now;
  const at = world.t - Math.min(lag, NET.maxLag);
  let i = h.length - 1;
  while (i > 0 && h[i].t > at) i--;
  const a = h[i].ents[e.id], b = (h[i + 1] || h[i]).ents[e.id];
  if (!a && !b) return now;
  let rec = b || a;
  if (a && b && a !== b) {
    const k = Math.min(1, Math.max(0, (at - h[i].t) / (h[i + 1].t - h[i].t)));
    // Across a change of body the later record is used whole; lerping would swing through space.
    if (a.groundId === b.groundId) {
      const up = norm(lerp(a.up, b.up, k));
      rec = { groundId: a.groundId, up, pos: lerp(a.pos, b.pos, k), rel: a.groundId ? lerp(a.rel, b.rel, k) : null };
    }
  } else if (a && !b) rec = a;
  return { pos: placeRec(rec, world.poses), up: rec.up };
}

// Where the shooter saw a rock `lag` seconds ago (capped). Rocks fly free, so a plain lerp between records.
export function seenRock(world, rock, lag) {
  const h = world.history;
  if (!(lag > 0) || !h?.length) return rock.pos;
  const at = world.t - Math.min(lag, world.tuning.NET.maxLag);
  let i = h.length - 1;
  while (i > 0 && h[i].t > at) i--;
  const a = h[i].rocks?.[rock.id], b = h[i + 1]?.rocks?.[rock.id];
  if (a && b) return lerp(a, b, Math.min(1, Math.max(0, (at - h[i].t) / (h[i + 1].t - h[i].t))));
  return b || a || rock.pos;
}
