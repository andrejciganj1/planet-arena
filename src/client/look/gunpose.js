// When guns fired and where the gun in view sits, from each entity's shot counter (it rises once per shot,
// pellets share it), as sounds.js hears shots. Pure, no three.js, so the tests can run it over predicted and
// interpolated states.
import { LOOK, WEAPONS } from "../../tuning.js";

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
