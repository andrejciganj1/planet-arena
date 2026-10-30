// A flying rock's tumble (x and y turn, radians) from its id and the match clock. Not from the rock's
// age: online, rocks come from snapshots that carry only id, pos, vel and owner.
import { hashRand } from "../sim/weapons.js";
import { surfaceInfo } from "../sim/collide.js";
import { sub, dot } from "../sim/vec.js";
import { ROCK_LOOK } from "../tuning.js";

export function tumble(id, t) {
  const next = hashRand(`tumble|${id}`), x = next() * 2 * Math.PI, y = next() * 2 * Math.PI;
  return [x + t, y + 0.7 * t];
}

// Adds a trail point (newest first, x y z) only when the game clock has moved since the last one, so the
// trail spans the same game time at any frame rate; between ticks the head just follows the drawn rock.
// Online the view draws rocks every frame, so a point per frame would shorten the warning on fast screens.
// heat, if given, is kept per point in trail.heats (newest first), so a trail lights from where it laid it.
export function trailPush(trail, [x, y, z], t, max = Infinity, heat = null) {
  const heats = heat === null ? null : (trail.heats ??= []);
  if (trail.pts.length && trail.t === t) (trail.pts.splice(0, 3, x, y, z), heats && (heats[0] = heat));
  else (trail.pts.unshift(x, y, z), heats?.unshift(heat), (trail.t = t));
  trail.pts.length = Math.min(trail.pts.length, 3 * max);
  if (heats) heats.length = trail.pts.length / 3;
}

// How brightly a flying rock lays its trail (0 to 1): only while it falls in on a body, closing on its
// surface, like a meteor entering an atmosphere. None out in space or moving away. Any body: planets, moons,
// comets and the sun.
//   rock: { pos, vel }; poses: the world's (with vel)
export function rockHeat(rock, system, poses, cfg = ROCK_LOOK) {
  const [from, full] = cfg.heat;
  let most = 0;
  for (const b of system.bodies) {
    const q = poses[b.id], s = surfaceInfo(b, q, rock.pos);
    if (s.dist >= from || dot(sub(rock.vel, q.vel), s.normal) >= 0) continue;
    const k = Math.min(1, Math.max(0, (from - s.dist) / (from - full)));
    most = Math.max(most, k * k * (3 - 2 * k));
  }
  return most;
}

// Drops a trail's oldest point once per game tick, so one left behind (a boost that stopped) fades from its
// far end at the pace it was laid. Returns true once it is empty.
export function trailFade(trail, t) {
  if (trail.pts.length && trail.t !== t) (trail.pts.length -= 3), (trail.t = t);
  return !trail.pts.length;
}
