// A flying rock's tumble (x and y turn, radians) from its id and the match clock. Not from the rock's
// age: online, rocks come from snapshots that carry only id, pos, vel and owner.
import { hashRand } from "../sim/weapons.js";

export function tumble(id, t) {
  const next = hashRand(`tumble|${id}`), x = next() * 2 * Math.PI, y = next() * 2 * Math.PI;
  return [x + t, y + 0.7 * t];
}

// Adds a trail point (newest first, x y z) only when the game clock has moved since the last one, so the
// trail spans the same game time at any frame rate; between ticks the head just follows the drawn rock.
// Online the view draws rocks every frame, so a point per frame would shorten the warning on fast screens.
export function trailPush(trail, [x, y, z], t, max = Infinity) {
  if (trail.pts.length && trail.t === t) trail.pts.splice(0, 3, x, y, z);
  else (trail.pts.unshift(x, y, z), (trail.t = t));
  trail.pts.length = Math.min(trail.pts.length, 3 * max);
}

// Drops a trail's oldest point once per game tick, so one left behind (a boost that stopped) fades from its
// far end at the pace it was laid. Returns true once it is empty.
export function trailFade(trail, t) {
  if (trail.pts.length && trail.t !== t) (trail.pts.length -= 3), (trail.t = t);
  return !trail.pts.length;
}
