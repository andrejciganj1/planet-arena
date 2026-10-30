// Solar flares: when the sun warns and burns, from the match clock alone, so the server, the look, the HUD
// and the sounds all agree with nothing sent.
import { FLARE } from "../tuning.js";
import { hashRand } from "./weapons.js";

const warnOf = (k, F) => F.first + k * F.every + (hashRand(`flare|${k}`)() * 2 - 1) * F.jitter;

// The flare whose window [warnAt, endAt + fade) holds t, else the next one. Only the slots round t are
// looked at: a server's clock runs for days. phase: "calm" | "warn" | "burn" | "fade".
export function flareAt(t, F = FLARE) {
  let k = Math.max(0, Math.floor((t - F.first) / F.every) - 1);
  for (;; k++) {
    const warnAt = warnOf(k, F), burnAt = warnAt + F.warn, endAt = burnAt + F.burn;
    if (t >= endAt + F.fade) continue;
    const phase = t < warnAt ? "calm" : t < burnAt ? "warn" : t < endAt ? "burn" : "fade";
    return { k, warnAt, burnAt, endAt, phase };
  }
}
