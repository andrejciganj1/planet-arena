// When guns fired and where the gun in view sits, from each entity's shot counter (it rises once per shot,
// pellets share it), as sounds.js hears shots. Pure, no three.js, so the tests can run it over predicted and
// interpolated states.
import { LOOK, WEAPONS } from "../../tuning.js";
import { createBoostWatch } from "./alienpose.js";

// Per entity, the time of its last shot. Only a new highest count is a shot: online a correction can put your
// count back and a replay raise it again, and that shot was shown already.
export function createGunWatch() {
  const seen = new Map(); // id -> { ref, shots, weapon, at, gun, frame }
  return {
    // e: the entity as drawn; now: real s. Returns since (s since its last shot, Infinity before any) and
    // gun (the weapon that fired it: the last round can hand over the pistol in the same tick).
    frame(e, now) {
      let m = seen.get(e.id);
      if (!m || m.ref !== e) seen.set(e.id, (m = { ref: e, shots: e.shots, weapon: e.weapon, at: -Infinity, gun: e.weapon, frame: now }));
      else if (e.shots > m.shots) {
        // The last round hands over the pistol in the same tick: that shot was the old weapon's.
        const emptied = e.weapon !== m.weapon && !!WEAPONS[m.weapon]?.ammo && !(e.ammo?.[m.weapon] > 0);
        m.shots = e.shots;
        m.at = now;
        m.gun = emptied ? m.weapon : e.weapon;
      }
      m.weapon = e.weapon;
      m.frame = now;
      return { since: now - m.at, gun: m.gun };
    },
    // Forgets entities not seen since `before` (players who left).
    sweep(before) {
      for (const [id, m] of seen) if (m.frame < before) seen.delete(id);
    },
  };
}

// The share of the kick left `since` s after a shot: all of it at once, easing back to none.
const kickLeft = (since, cfg) => (since >= 0 && since < cfg.kick.time ? (1 - since / cfg.kick.time) ** 2 : 0);

// The gun in view in the camera's frame: pos (m), its pitch up (rad, the kick) and scale. It
// depends on nothing but the weapon and its last shot, so the online correction shift, which moves the
// camera, never moves the gun on screen.
export function viewGun(weapon, since, cfg = LOOK.weapons) {
  const k = kickLeft(since, cfg) * (cfg.kick.by[weapon] ?? 1);
  const [x, y, z] = cfg.view;
  return { pos: [x, y, z + cfg.kick.back * k], pitch: cfg.kick.up * k, scale: cfg.scale };
}

// Whether a muzzle flash shows `since` s after a shot.
export const flashShown = (since, cfg = LOOK.weapons) => since >= 0 && since < cfg.flash.time;

// Your own boost, felt in first person: how strong the thrust is now (0 to 1), easing in and out as boosts
// start and stop all the time. None while dead or on the ground.
export function createThrust(cfg = LOOK.thrust) {
  const boosts = createBoostWatch();
  let k = 0;
  return {
    // e: you as drawn (or nothing yet); t, dt: s of real time.
    frame(e, t, dt) {
      const on = !!e && boosts.frame(e, t);
      k += ((on ? 1 : 0) - k) * (1 - Math.exp(-Math.max(0, dt) / cfg.ease));
      return k;
    },
  };
}

// What a thrust of k does to your view at time t (s): fov, degrees the view widens; gun, the gun in view's
// shift in the camera's frame (m: right, up, back), a dip and a small shake; glow, the light of your flames
// from below the screen, flickering on the flames' beat.
export function thrustView(k, t, cfg = LOOK.thrust, jet = LOOK.alien.jet) {
  if (k <= 0) return { fov: 0, gun: [0, 0, 0], glow: 0 };
  const a = cfg.shakeRate * t;
  const waver = 1 + jet.flicker * 0.5 * (Math.sin(jet.rate * t) + Math.sin(1.73 * jet.rate * t + 1));
  return {
    fov: cfg.fov * k,
    gun: [cfg.shake * k * Math.sin(1.3 * a + 2), -cfg.dip * k + cfg.shake * k * Math.sin(a), cfg.shake * k * Math.sin(0.7 * a)],
    glow: cfg.glow * k * waver,
  };
}
