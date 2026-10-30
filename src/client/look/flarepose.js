// What a solar flare shows, from the match clock alone (no three.js, so node tests load it).
import { FLARE } from "../../tuning.js";
import { flareAt } from "../../sim/flares.js";

// The banner over the game: the warning's countdown, then the burn's order; null when there is no flare.
export function flareBanner(t, F = FLARE) {
  const f = flareAt(t, F);
  if (f.phase === "warn") return { text: "IMMINENT SOLAR FLARE DETECTED", count: Math.ceil(f.burnAt - t) };
  if (f.phase === "burn") return { text: "SOLAR FLARE: GET OUT OF THE LIGHT", count: null };
  return null;
}
