// Every gameplay number lives here. Tests read these too, so after a playtest change numbers here and
// rerun `node --test 'tests/*.test.mjs'`: the property tests say whether the system still plays right.

export const TICK = 1 / 60;
export const MAX_TICKS = 5; // per frame; a slow frame or hidden tab drops time instead of catching up
export const VOID_RADIUS = 400; // from the sun; beyond it you are lost in space

// g is the full pull within `reach` of the core, falling off as g * (reach / d)^2 beyond. For spheres
// reach is the radius. Orbits are circles in the XZ plane, angle = phase + 2 pi t / period.
export const BODIES = [
  { id: "sun", kind: "sun", radius: 18, g: 22, reach: 18, orbit: null, pos: [0, 0, 0], color: 0xffc23d },
  { id: "tiny", kind: "planet", radius: 6, g: 4, reach: 6, orbit: { around: "sun", radius: 70, period: 120, phase: 0 }, color: 0x7fd36b },
  { id: "mid", kind: "planet", radius: 12, g: 9, reach: 12, orbit: { around: "sun", radius: 120, period: 200, phase: 2.1 }, color: 0x4f9de8 },
  { id: "heavy", kind: "planet", radius: 18, g: 13, reach: 18, orbit: { around: "sun", radius: 200, period: 300, phase: 4.2 }, color: 0xd9744a },
  { id: "moon", kind: "moon", radius: 5, g: 3, reach: 5, orbit: { around: "heavy", radius: 45, period: 90, phase: 0 }, color: 0xc9c4bd },
  { id: "station", kind: "station", size: [24, 2, 16], g: 3, reach: 8, orbit: null, pos: [0, 8, -92], color: 0xb8c2cc },
];

export const PLAYER = {
  radius: 0.5, // hit sphere, centred radius above the feet
  height: 1.8,
  eye: 1.6,
  run: 9, // m/s
  accel: 60, // m/s^2 towards the wished velocity on the ground
  friction: 8, // 1/s, with no move input
  jump: 6, // m/s
  upTurn: 4, // rad/s, how fast "up" follows the ground or the body you fall to
  snap: 0.4, // m; a grounded runner stays stuck to the surface this far, so speed can't fling them off
  groundAngle: 45, // degrees from up that still counts as standing
  health: 100,
  respawn: 3, // s
  spawnFromPad: 4, // m, spawn points keep this clear of pads
  spawnFromOther: 20, // m, a respawning player keeps this far from the other entity
};

export const BOOST = { accel: 12, fuel: 1.5, refill: 0.5 };

export const PISTOL = { speed: 120, damage: 10, cooldown: 0.35 };

// Splash damage and knockback fall off linearly to zero at `splash`, measured to the hit sphere centre.
export const ROCKET = { speed: 30, cooldown: 0.9, splash: 4, damage: 90, knockback: 18, self: 0.5 };

export const SHOT = { ownerGrace: 0.1 }; // s a projectile can't hit its own shooter

export const DUMMY = { health: 100, respawn: 3, body: "tiny" };

export const PLAYER_BODY = "mid"; // where the player starts and respawns

// Pads: `dir` is a unit vector in world axes (nothing spins), both where the pad sits on its body and
// which way it launches.
export const PADS = [
  { id: "tiny-a", body: "tiny", dir: [1, 0, 0], speed: 28 },
  { id: "tiny-b", body: "tiny", dir: [-1, 0, 0], speed: 28 },
  { id: "mid-a", body: "mid", dir: [0, 0, 1], speed: 28 },
  { id: "mid-b", body: "mid", dir: [0, 0, -1], speed: 28 },
  { id: "heavy-a", body: "heavy", dir: [1, 0, 0], speed: 28 },
  { id: "heavy-b", body: "heavy", dir: [-1, 0, 0], speed: 28 },
  { id: "station-a", body: "station", dir: [0, 1, 0], speed: 28 },
];

// touch: feet within this of a pad launch; lockout: no relaunch for this long.
export const PAD = { touch: 1.2, lockout: 1 };
export const PAD_CUE = { refresh: 0.25, predict: 20, showPathWithin: 15 };
