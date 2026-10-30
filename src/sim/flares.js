// Solar flares: when the sun warns and burns, from the match clock alone, so the server, the look, the HUD
// and the sounds all agree with nothing sent.
import { FLARE } from "../tuning.js";
import { hashRand } from "./weapons.js";
import { segmentHit, surfaceInfo } from "./collide.js";
import { hitCentre } from "./entity.js";
import { sub, dot, dist } from "./vec.js";

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

// True when nothing stands between p and the sun's centre (bodies by their real shapes; asteroids and
// players cast no shadow). `ground`, a body id, is left out: its own shade is judged by its slope.
export function sunlit(world, p, ground = null) {
  const sun = world.system.bodies.find((b) => b.kind === "sun");
  const system = ground ? { bodies: world.system.bodies.filter((b) => b.id !== ground), byId: world.system.byId } : world.system;
  const hit = segmentHit(system, world.poses, p, world.poses[sun.id].pos);
  return !hit || hit.id === sun.id;
}

// Health/s the flare would take from a point in its light, whatever the phase: full near the sun, fading out.
export function flareReach(world, p, F = world.tuning.FLARE, ground = null) {
  const sun = world.system.bodies.find((b) => b.kind === "sun");
  const d = dist(p, world.poses[sun.id].pos);
  if (d >= F.reach || !sunlit(world, p, ground)) return 0;
  return F.rate * Math.min(1, (F.reach - d) / (F.reach - F.full));
}

// Standing, your own ground shades you where its slope turns from the sun's centre, exactly where the planet
// is drawn dark; the line from your middle would still clear the horizon a few degrees further on.
function groundShade(world, e) {
  if (!e.groundId) return false;
  const sun = world.poses[world.system.bodies.find((b) => b.kind === "sun").id].pos;
  const { normal } = surfaceInfo(world.system.byId[e.groundId], world.poses[e.groundId], e.pos);
  return dot(normal, sub(sun, e.pos)) <= 0;
}

// Health/s a burn would take from e where it is ({ pos, up, groundId } is enough), whatever the phase.
export function exposure(world, e, F = world.tuning.FLARE) {
  if (groundShade(world, e)) return 0;
  return flareReach(world, hitCentre(e), F, e.groundId);
}

// Health/s the flare takes from e now: players and the dummy, alive, in its light, during a burn.
export function burnRate(world, e, F = world.tuning.FLARE) {
  if (!e.alive || (e.kind !== "player" && e.kind !== "dummy") || flareAt(world.t, F).phase !== "burn") return 0;
  return exposure(world, e, F);
}

// The burn, once a tick. No hit events and no credit: it would flash and sound 60 times a second, and
// nobody shot you. The browser's cosmetic world never hurts anyone. flareTick marks a death as the flare's.
export function stepFlare(world, dt) {
  if (world.cosmetic || flareAt(world.t, world.tuning.FLARE).phase !== "burn") return;
  for (const e of Object.values(world.entities)) {
    const rate = burnRate(world, e);
    if (rate <= 0) continue;
    e.health -= rate * dt;
    e.flareTick = world.tick;
  }
}
