// How an alien moves, made in code (no rig): a handful of angles from its state each frame. Pure, no
// three.js, so the tests can check every pose. Angles are rotations about the figure's own right axis
// (+x), so positive swings a limb forward and up; `lean` is positive forward.
import { PLAYER, LOOK } from "../../tuning.js";
import { dot, len, sub, scale } from "../../sim/vec.js";

export const POSE_KEYS = ["legL", "legR", "armL", "armR", "lean", "headPitch"];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

// A steady stride offset per figure, so a crowd doesn't walk in step.
function phaseOf(id) {
  let h = 7;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 997) / 997) * 2 * Math.PI;
}

// The slow part of the pose (what easing smooths) and how hard the legs swing (0 to 1). Arms and legs are
// angles from the leaning body; the gun arm adds the lean back so it keeps to the aim whatever the lean.
//   boosting: the booster is firing (fuel going down in the air; see createPoser)
export function poseParts(e, boosting = false, cfg = LOOK.alien.pose) {
  const aim = clamp(e.pitch || 0, cfg.aim[0], cfg.aim[1]);
  let legL, legR, armL, lean, walk = 0;
  if (e.groundId) {
    // Grounded `vel` is relative to the ground, so this is the speed over it.
    const along = sub(e.vel, scale(e.up, dot(e.vel, e.up)));
    walk = Math.min(1, len(along) / PLAYER.run);
    [legL, legR] = [0, 0];
    lean = cfg.lean.walk * walk;
    armL = Math.PI / 2 + aim + cfg.support;
  } else if (boosting) {
    [legL, legR] = cfg.trail;
    lean = cfg.lean.boost;
    armL = Math.PI / 2 + aim + cfg.support;
  } else {
    // Just jumped: knees up, leaning back a little; a while in the air: legs apart, a hand up, tipping forward.
    const k = smooth(clamp((e.airTime || 0) / cfg.fall, 0, 1));
    legL = mix(cfg.tuck[0], cfg.dangle[0], k);
    legR = mix(cfg.tuck[1], cfg.dangle[1], k);
    lean = mix(cfg.lean.jump, cfg.lean.fall, k);
    armL = mix(Math.PI / 2 + aim + cfg.support, cfg.flail, k);
  }
  // The hook arm reaches out where you look, a little above the gun.
  if (e.hook) armL = Math.PI / 2 + Math.min(aim + cfg.reach, cfg.aim[1] + cfg.reach / 2);
  return {
    legL, legR,
    armL: armL + lean,
    armR: Math.PI / 2 + aim + lean,
    lean,
    headPitch: clamp(e.pitch || 0, -cfg.head, cfg.head),
    walk,
  };
}

// The pose at time t (s) from its parts: the stride swings the legs and the free arm.
export function composePose(parts, t, id, cfg = LOOK.alien.pose) {
  const s = Math.sin(2 * Math.PI * cfg.steps * t + phaseOf(id)) * parts.walk;
  return {
    legL: parts.legL + cfg.swing * s,
    legR: parts.legR - cfg.swing * s,
    armL: parts.armL - cfg.armSwing * s,
    armR: parts.armR,
    lean: parts.lean,
    headPitch: parts.headPitch,
  };
}

export const alienPose = (e, t, boosting = false) => composePose(poseParts(e, boosting), t, e.id);

// Where each part goes for a pose: { pos, rx } per node in the figure's frame (feet at the origin, up +y,
// facing -z), rx its turn about +x. The body leans about the head's centre, so the head (the hit sphere a
// shot tests) never moves; the head only turns in place.
//   rest: each node's rest pivot from the model ({ body, armL, armR, legL, legR }: [x, y, z])
export function placeAlien(pose, rest, hit = PLAYER.hit) {
  const c = hit.head.at, a = -pose.lean, cos = Math.cos(a), sin = Math.sin(a);
  const turn = (p) => {
    const dy = p[1] - c, dz = p[2];
    return [p[0], c + dy * cos - dz * sin, dy * sin + dz * cos];
  };
  return {
    head: { pos: [0, c, 0], rx: pose.headPitch },
    body: { pos: turn(rest.body), rx: a },
    legL: { pos: turn(rest.legL), rx: a + pose.legL },
    legR: { pos: turn(rest.legR), rx: a + pose.legR },
    armL: { pos: turn(rest.armL), rx: a + pose.armL },
    armR: { pos: turn(rest.armR), rx: a + pose.armR },
  };
}

// Poses for drawn figures, eased so they never snap: other players' state arrives in snapshot steps (pitch,
// speed and fuel jump at each one), and the switch between ground and air changes the target at once. Also
// tells boosting from fuel going down in the air, held a moment as fuel arrives in steps.
export function createPoser(cfg = LOOK.alien.pose) {
  const seen = new Map(); // id -> { parts, fuel, boostUntil, boosting, at }
  return {
    // e: the entity as drawn; t, dt: s of real time.
    frame(e, t, dt) {
      let m = seen.get(e.id);
      if (!m) seen.set(e.id, (m = { parts: null, fuel: e.fuel, boostUntil: -Infinity, boosting: false, at: t }));
      if (!e.groundId && e.fuel < m.fuel - 1e-9) m.boostUntil = t + cfg.boostHold;
      m.boosting = !e.groundId && t < m.boostUntil;
      m.fuel = e.fuel;
      m.at = t;
      const target = poseParts(e, m.boosting, cfg);
      if (!m.parts) m.parts = target;
      else {
        const k = 1 - Math.exp(-Math.max(0, dt) / cfg.ease);
        for (const key in target) m.parts[key] += (target[key] - m.parts[key]) * k;
      }
      return composePose(m.parts, t, e.id, cfg);
    },
    boosting: (e) => !!seen.get(e.id)?.boosting,
    // Starts a figure afresh (a respawn shouldn't ease in from where it died).
    drop: (id) => seen.delete(id),
    // Forgets figures not drawn since `before` (players who left).
    sweep(before) {
      for (const [id, m] of seen) if (m.at < before) seen.delete(id);
    },
  };
}
