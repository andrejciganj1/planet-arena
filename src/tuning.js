// Every gameplay number lives here. Tests read these too, so after a playtest change numbers here and
// rerun `node --test 'tests/*.test.mjs'`: the property tests say whether the system still plays right.

export const TICK = 1 / 60;
export const MAX_TICKS = 5; // per frame; a slow frame or hidden tab drops time instead of catching up
export const VOID_RADIUS = 460; // from the sun; beyond it you are lost in space (the far comet reaches 400)

// g is the full pull within `reach` of the core, falling off as g * (reach / d)^2 beyond. Planets and the
// moon keep it to 1.75x their radius, so a rocket blast or a booster burn doesn't easily throw you off.
// Within `hold` metres of a body's surface only that body pulls; the others fade back in over the next
// `hold` metres (see gravity.js). Orbits are circles in the XZ plane, angle = phase + 2 pi t / period.
export const BODIES = [
  { id: "sun", kind: "sun", radius: 25, g: 24, reach: 25, hold: 0, orbit: null, pos: [0, 0, 0], color: 0xffc23d },
  { id: "hot", kind: "planet", radius: 7, g: 11, reach: 12.25, hold: 8, orbit: { around: "sun", radius: 46, period: 80, phase: 1.0 }, color: 0xe0525e },
  { id: "tiny", kind: "planet", radius: 6, g: 8, reach: 10.5, hold: 8, orbit: { around: "sun", radius: 78, period: 120, phase: 0 }, color: 0x7fd36b },
  { id: "mid", kind: "planet", radius: 12, g: 10, reach: 21, hold: 8, orbit: { around: "sun", radius: 120, period: 200, phase: 2.1 }, color: 0x4f9de8 },
  { id: "heavy", kind: "planet", radius: 23, g: 13, reach: 40.25, hold: 10, orbit: { around: "sun", radius: 200, period: 300, phase: 4.2 }, color: 0xd9744a },
  { id: "moon", kind: "moon", radius: 5, g: 3, reach: 8.75, hold: 4, orbit: { around: "heavy", radius: 40, period: 90, phase: 0 }, color: 0xc9c4bd },
  { id: "giant", kind: "planet", radius: 18, g: 9, reach: 31.5, hold: 10, orbit: { around: "sun", radius: 270, period: 420, phase: 5.6 }, color: 0x8a6fd6, ring: { inner: 1.4, outer: 2.3, tilt: 18 } },
  { id: "far", kind: "planet", radius: 5, g: 8.5, reach: 8.75, hold: 6, orbit: { around: "sun", radius: 340, period: 840, phase: 0.7 }, color: 0x6fd3c9 },
  // Comets: tilted ellipses, peri and apo in metres from the sun, inc/node/arg in degrees, phase in radians
  // (see system.js). Searched so that over the full CYCLE no comet comes within 3 m of any body and some
  // comet passes close to some planet at least every 120 s (tests/system.test.mjs). Two fast ones meet the
  // inner planets often; the slow one (comet-c) passes the heavy or giant planet at least every six minutes;
  // the far one (comet-d) swings out to 387 m, past the far planet's path, on a 14-minute lap.
  { id: "comet-a", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, orbit: { around: "sun", peri: 38.8, apo: 260.3, period: 240, phase: 3.39, inc: 12.4, node: 37, arg: 219 }, color: 0xbfe8ff },
  { id: "comet-b", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, orbit: { around: "sun", peri: 48.8, apo: 256.6, period: 240, phase: 0.019, inc: 22.6, node: 134, arg: 289 }, color: 0xbfe8ff },
  { id: "comet-c", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, orbit: { around: "sun", peri: 53.8, apo: 247.8, period: 600, phase: 5.633, inc: 11.1, node: 286, arg: 20 }, color: 0xbfe8ff },
  { id: "comet-d", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, orbit: { around: "sun", peri: 38, apo: 386.7, period: 840, phase: 5.495, inc: 12.4, node: 245, arg: 179 }, color: 0xbfe8ff },
];

// Looks only, no collisions or gravity: you fly straight through both. The giant's `ring` is in multiples
// of its radius, tilted `tilt` degrees from the orbital plane. The belt is a band of rocks round the sun
// between the mid and heavy planets' paths (radii in m, `size` the range of rock sizes in m, one lap per
// `period` s).
export const BELT = { inner: 148, outer: 160, thick: 4, rocks: 500, size: [0.4, 1.8], period: 260 };

// s; every orbit period divides it, so the whole system repeats exactly and can be checked over one cycle.
export const CYCLE = 25200;
// close: metres between a comet's and a planet's surfaces that count as a close pass (a chance to hop on or off).
export const COMET = { close: 10 };

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
  adrift: 25, // s in the air before you count as lost in space (pad flights land within 20 s)
  spawnFromPad: 4, // m, spawn points keep this clear of pads
  spawnFromOther: 20, // m, a respawning player keeps this far from the other entity
};

export const BOOST = { accel: 12, fuel: 1.5, refill: 0.5 };

// Weapons, keyed by name. type: "bullet" (falls with gravity), "rocket" (bullet that explodes) or "ray"
// (instant and straight). spread: half-angle of the cone in degrees. ammo: { pickup: rounds a weapon pickup
// gives, box: rounds an ammo box gives, max: the most you carry }; null means unlimited (the pistol).
// Rocket: splash damage and knockback fall off linearly to zero at `splash`, measured to the hit sphere
// centre; `self` scales damage to the shooter.
export const WEAPONS = {
  pistol: { type: "bullet", speed: 120, damage: 10, cooldown: 0.35, spread: 0, ammo: null },
  shotgun: { type: "bullet", speed: 120, damage: 10, cooldown: 0.9, spread: 7, pellets: 10, range: 35, push: 0.8, ammo: { pickup: 8, box: 8, max: 24 } },
  rocket: { type: "rocket", speed: 30, damage: 90, cooldown: 0.9, spread: 0, splash: 4, knockback: 15, self: 0.5, showFor: 0.5, ammo: { pickup: 5, box: 5, max: 15 } },
  minigun: { type: "bullet", speed: 120, damage: 6, cooldown: 0.08, spread: 1.2, ammo: { pickup: 100, box: 80, max: 300 } },
  sniper: { type: "bullet", speed: 600, damage: 75, cooldown: 1.5, spread: 0, zoom: 4, ammo: { pickup: 5, box: 5, max: 15 } },
  railgun: { type: "ray", damage: 90, cooldown: 1.5, spread: 0, range: 800, showFor: 0.5, ammo: { pickup: 5, box: 5, max: 10 } },
};
// Keys 1 to 6, and the wheel's order.
export const WEAPON_ORDER = ["pistol", "shotgun", "rocket", "minigun", "sniper", "railgun"];
export const PISTOL = WEAPONS.pistol;
export const ROCKET = WEAPONS.rocket;

export const SHOT = { ownerGrace: 0.1 }; // s a projectile can't hit its own shooter

export const DUMMY = { health: 100, respawn: 3, body: "tiny" };

export const PLAYER_BODY = "mid"; // where the player starts and respawns

// Online players spawn on these only (the small outer planets and the hot one are for the long trips).
export const SPAWN_BODIES = ["tiny", "mid", "heavy", "giant"];

// standing: s on the ground, and since the last hit, after which a fall no longer counts as the hitter's kill.
export const KILL = { standing: 1 };

// One per player slot; index 0 is the solo player's.
export const COLOURS = [0xffd23f, 0xe8505b, 0x4fb0e8, 0x6fd36b, 0xb06fe8, 0xff8a3d, 0x3fd9c4, 0xf08bc8];

// What being hit and kills look like (seconds unless noted). Looks only. Vignette: full strength at `full`
// damage, never above `max`; the bar over a hit player flashes white for `flash`.
export const FEEDBACK = { vignetteFade: 0.4, vignetteMax: 0.7, full: 50, arcFade: 1, feedFor: 5, flash: 0.15, feedMax: 6 };

// Online play. Ticks unless noted: maxLag, history, rejoin, unreachable and smooth are seconds, snap is metres.
export const NET = {
  maxPlayers: 8, snapEvery: 2, interp: 6, slack: [2, 5], hold: 15, maxAhead: 60, maxLag: 0.5, history: 0.6,
  rejoin: 10, unreachable: 30, smooth: 0.1, snap: 4, resync: 60, lead: 6, nameMax: 16,
};

// Pads: `dir` is the launch direction in world axes (nothing spins); the pad sits on its body out along
// `dir`. heading(a, el) is the unit vector at `a` degrees round the
// orbital plane (from +x towards +z) and `el` degrees above it. The layout was searched so every pad has a
// launch window of at least 5 s and every planet has one at least once a minute (tests/pads.test.mjs).
// Speed is per planet, a little above what it takes to leave it: heavier planets need faster pads.
const heading = (a, el = 0) => {
  const r = Math.PI / 180, c = Math.cos(el * r);
  return [c * Math.cos(a * r), Math.sin(el * r), c * Math.sin(a * r)];
};
export const PADS = [
  { id: "hot-a", body: "hot", dir: heading(15), speed: 26 },
  { id: "hot-b", body: "hot", dir: heading(225), speed: 26 },
  { id: "hot-c", body: "hot", dir: heading(285), speed: 26 },
  { id: "tiny-a", body: "tiny", dir: heading(120), speed: 18 },
  { id: "tiny-b", body: "tiny", dir: heading(210), speed: 18 },
  { id: "tiny-c", body: "tiny", dir: heading(285), speed: 18 },
  { id: "mid-a", body: "mid", dir: heading(60), speed: 28 },
  { id: "mid-b", body: "mid", dir: heading(225), speed: 28 },
  { id: "mid-c", body: "mid", dir: heading(345), speed: 28 },
  { id: "heavy-a", body: "heavy", dir: heading(45), speed: 44 },
  { id: "heavy-b", body: "heavy", dir: heading(150), speed: 44 },
  { id: "heavy-c", body: "heavy", dir: heading(225), speed: 44 },
  { id: "giant-a", body: "giant", dir: heading(120), speed: 33 },
  { id: "giant-b", body: "giant", dir: heading(240), speed: 33 },
  { id: "giant-c", body: "giant", dir: heading(345), speed: 33 },
  { id: "far-a", body: "far", dir: heading(45), speed: 24 },
  { id: "far-b", body: "far", dir: heading(105), speed: 24 },
  { id: "far-c", body: "far", dir: heading(300), speed: 24 },
];

// The hook. range: m along the view it reaches; pull: m/s^2 towards the caught point, applied only while
// closing slower than `speed` m/s; steady: 1/s, how fast sideways motion relative to the caught body dies
// away, so the rope reels you in instead of swinging you round it; cooldown: s after letting go (or a
// miss) before it fires again.
export const HOOK = { range: 25, pull: 30, speed: 15, steady: 3, cooldown: 0.5 };

// Pickups. touch: feet within this of one take it; health: points a pack restores; fuelMax: the fuel
// pickup fills the booster to this many tanks (the extra is used up, never refilled by standing);
// respawn: seconds until a taken pickup comes back, by kind.
export const PICKUP = { touch: 1.2, health: 25, fuelMax: 2, respawn: { health: 20, ammo: 15, weapon: 30, fuel: 40 } };
// Fixed spots, the same every match, so players learn routes. The sniper rifle sits on the far planet and
// the railgun on the hot planet, the hard places to reach (tests/pickups.test.mjs checks the layout rules).
export const PICKUPS = [
  { id: "hot-railgun", body: "hot", dir: heading(0, 50), kind: "weapon", weapon: "railgun" },
  { id: "hot-health", body: "hot", dir: heading(120, -45), kind: "health" },
  { id: "hot-fuel", body: "hot", dir: heading(240, 45), kind: "fuel" },
  { id: "tiny-shotgun", body: "tiny", dir: heading(0, 50), kind: "weapon", weapon: "shotgun" },
  { id: "tiny-health", body: "tiny", dir: heading(180, -50), kind: "health" },
  { id: "tiny-shotgun-ammo", body: "tiny", dir: heading(90, -50), kind: "ammo", weapon: "shotgun" },
  { id: "mid-minigun", body: "mid", dir: heading(90, 45), kind: "weapon", weapon: "minigun" },
  { id: "mid-health", body: "mid", dir: heading(270, -45), kind: "health" },
  { id: "mid-health-2", body: "mid", dir: heading(300, 60), kind: "health" },
  { id: "mid-minigun-ammo", body: "mid", dir: heading(150, -40), kind: "ammo", weapon: "minigun" },
  { id: "mid-shotgun-ammo", body: "mid", dir: heading(200, 40), kind: "ammo", weapon: "shotgun" },
  { id: "heavy-rocket", body: "heavy", dir: heading(60, 40), kind: "weapon", weapon: "rocket" },
  { id: "heavy-health", body: "heavy", dir: heading(200, -40), kind: "health" },
  { id: "heavy-rocket-ammo", body: "heavy", dir: heading(300, 35), kind: "ammo", weapon: "rocket" },
  { id: "heavy-minigun-ammo", body: "heavy", dir: heading(0, -35), kind: "ammo", weapon: "minigun" },
  { id: "moon-health", body: "moon", dir: heading(0, 40), kind: "health" },
  { id: "moon-sniper-ammo", body: "moon", dir: heading(180, -40), kind: "ammo", weapon: "sniper" },
  { id: "giant-minigun", body: "giant", dir: heading(30, 40), kind: "weapon", weapon: "minigun" },
  { id: "giant-health", body: "giant", dir: heading(150, -40), kind: "health" },
  { id: "giant-health-2", body: "giant", dir: heading(270, 50), kind: "health" },
  { id: "giant-fuel", body: "giant", dir: heading(90, -50), kind: "fuel" },
  { id: "giant-rocket-ammo", body: "giant", dir: heading(210, 35), kind: "ammo", weapon: "rocket" },
  { id: "giant-sniper-ammo", body: "giant", dir: heading(330, -35), kind: "ammo", weapon: "sniper" },
  { id: "giant-railgun-ammo", body: "giant", dir: heading(0, 60), kind: "ammo", weapon: "railgun" },
  { id: "far-sniper", body: "far", dir: heading(0, 50), kind: "weapon", weapon: "sniper" },
  { id: "far-sniper-ammo", body: "far", dir: heading(180, -50), kind: "ammo", weapon: "sniper" },
];

// touch: feet within this of a pad launch; lockout: no relaunch for this long.
export const PAD = { touch: 1.2, lockout: 1 };
// pathEvery: keep one predicted point every this many ticks for drawing.
export const PAD_CUE = { refresh: 0.25, predict: 20, showPathWithin: 15, pathEvery: 6 };

// mouse: radians of turn per pixel of mouse movement.
export const CONTROLS = { mouse: 0.0022 };
