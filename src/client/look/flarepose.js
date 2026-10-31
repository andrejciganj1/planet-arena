// What a solar flare shows, from the match clock alone (no three.js, so node tests load it).
import { FLARE, LOOK } from "../../tuning.js";
import { flareAt } from "../../sim/flares.js";
import { hashRand } from "../../sim/weapons.js";
import { hitCentre } from "../../sim/entity.js";
import { dist } from "../../sim/vec.js";

// The banner over the game: the warning's countdown, then the burn's order; null when there is no flare.
export function flareBanner(t, F = FLARE) {
  const f = flareAt(t, F);
  if (f.phase === "warn") return { text: "SOLAR FLARE INCOMING", count: Math.ceil(f.burnAt - t) };
  if (f.phase === "burn") return { text: "SOLAR FLARE: GET OUT OF THE LIGHT", count: null };
  return null;
}

// Where a flare stands for the look at time t: { warn: 0..1 through the warning (0 outside it), burn: 0..1
// brightness, rising fast and holding while it burns so the sun blazes as long as the damage lasts, since: s
// from the burst (-Infinity between flares), dir: the main patch's unit vector, dir2: the smaller patch's }.
// After the burn it dims over `dim` s.
export function flareView(t, F = FLARE, cfg = LOOK.flare) {
  const f = flareAt(t, F);
  const r = hashRand(`flare-dir|${f.k}`);
  const a = r() * Math.PI * 2, e = (r() - 0.5) * 0.9;
  const dir = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  // The smaller patch `apart` degrees round the sun from it, turned level, so it stays near the planets' plane.
  const side = [-dir[2], 0, dir[0]], n = Math.hypot(side[0], side[2]), th = (cfg.second.apart * Math.PI) / 180;
  const dir2 = dir.map((d, i) => Math.cos(th) * d + (Math.sin(th) * side[i]) / n);
  const burn = f.phase === "burn" ? Math.min(1, (t - f.burnAt) / cfg.rise) : f.phase === "fade" ? Math.max(0, 1 - (t - f.endAt) / cfg.dim) : 0;
  return {
    warn: f.phase === "warn" ? (t - f.warnAt) / F.warn : 0,
    burn, since: f.phase === "calm" ? -Infinity : t - f.burnAt, dir, dir2,
  };
}

// Your distance to the sun for the HUD, from your middle to its centre as the flare measures it: near when a
// flare can reach you there.
export function sunReadout(world, e, F = FLARE) {
  const sun = world.system.sun;
  const d = dist(hitCentre(e), world.poses[sun.id].pos);
  return { text: `Sun ${Math.round(d)} m`, near: d < F.reach };
}
