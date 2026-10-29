// A flying rock's tumble (x and y turn, radians) from its id and the match clock. Not from the rock's
// age: online, rocks come from snapshots that carry only id, pos, vel and owner.
import { hashRand } from "../sim/weapons.js";

export function tumble(id, t) {
  const next = hashRand(`tumble|${id}`), x = next() * 2 * Math.PI, y = next() * 2 * Math.PI;
  return [x + t, y + 0.7 * t];
}
