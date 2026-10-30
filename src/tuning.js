// Every gameplay number lives here. Tests read these too, so after a playtest change numbers here and
// rerun `node --test 'tests/*.test.mjs'`: the property tests say whether the system still plays right.

export const TICK = 1 / 60;
export const MAX_TICKS = 5; // per frame; a slow frame or hidden tab drops time instead of catching up
export const VOID_RADIUS = 600; // from the sun; beyond it you are lost in space (the far comet reaches 376)

// g is the full pull within `reach` of the core, falling off as g * (reach / d)^2 beyond. Planets and
// moons keep it to 1.75x their radius, so a rocket blast or a booster burn doesn't easily throw you off.
// Within `hold` metres of a body's surface only that body pulls; the others fade back in over the next
// `hold` metres (see gravity.js). Orbits are circles in the XZ plane, angle = phase + 2 pi t / period.
// Moons: their planet outpulls them a few metres up, so a jump falls back to the moon or the planet. The
// mid planet's moon stays inside the belt. The giant's ring-moon orbits inside the ring band (looks only);
// its outer-moon crosses the heavy planet's band and misses it, and the heavy planet's moon, only by
// timing: its 140 s period has it facing away from the sun at every heavy-giant line-up (every 1050 s).
// Moon phases were searched so over the full CYCLE no moon comes within 3 m of another body (tests/system.test.mjs).
export const BODIES = [
  { id: "sun", kind: "sun", radius: 25, g: 24, reach: 25, hold: 0, orbit: null, pos: [0, 0, 0], color: 0xffc23d },
  { id: "hot", kind: "planet", radius: 7, g: 11, reach: 12.25, hold: 8, orbit: { around: "sun", radius: 46, period: 80, phase: 1.0 }, color: 0xe0525e },
  { id: "tiny", kind: "planet", radius: 6, g: 8, reach: 10.5, hold: 8, orbit: { around: "sun", radius: 78, period: 120, phase: 0 }, color: 0x7fd36b },
  { id: "mid", kind: "planet", radius: 12, g: 10, reach: 21, hold: 8, orbit: { around: "sun", radius: 120, period: 200, phase: 2.1 }, color: 0x4f9de8 },
  { id: "mid-moon", kind: "moon", radius: 2.5, g: 3, reach: 4.375, hold: 4, orbit: { around: "mid", radius: 22, period: 60, phase: 4.45 }, color: 0xb4c2cf },
  { id: "heavy", kind: "planet", radius: 23, g: 13, reach: 40.25, hold: 10, orbit: { around: "sun", radius: 200, period: 300, phase: 4.2 }, color: 0xd9744a },
  { id: "moon", kind: "moon", radius: 5, g: 3, reach: 8.75, hold: 4, orbit: { around: "heavy", radius: 40, period: 90, phase: 0 }, color: 0xc9c4bd },
  { id: "giant", kind: "planet", radius: 18, g: 9, reach: 31.5, hold: 10, orbit: { around: "sun", radius: 270, period: 420, phase: 5.6 }, color: 0x8a6fd6, ring: { inner: 1.4, outer: 2.3, tilt: 18 } },
  { id: "ring-moon", kind: "moon", radius: 3, g: 3, reach: 5.25, hold: 4, orbit: { around: "giant", radius: 32, period: 90, phase: 0.19 }, color: 0xc9bde0 },
  { id: "outer-moon", kind: "moon", radius: 4, g: 3, reach: 7, hold: 4, orbit: { around: "giant", radius: 52, period: 140, phase: 4.89 }, color: 0xd8cfae },
  { id: "far", kind: "planet", radius: 5, g: 8.5, reach: 8.75, hold: 6, orbit: { around: "sun", radius: 340, period: 840, phase: 0.7 }, color: 0x6fd3c9 },
  // Comets: tilted ellipses, peri and apo in metres from the sun, inc/node/arg in degrees, phase in radians,
  // kepler how much they rush past the sun and slow far out (1 is Kepler's law, see system.js). Softened so
  // the fastest point is at most about twice the slowest: far out they no longer crawl, so they lap sooner
  // and pass by more often. Found by tools/comet_search.mjs so that over the full CYCLE no comet comes within
  // 3 m of any body and some comet passes close to some planet at least every 120 s (tests/system.test.mjs).
  // The two fast ones meet the inner planets often on 80 s laps. The slow one (comet-c) shares the heavy
  // planet's 5-minute lap and crosses its path where the planet is, so it passes it every lap to hop off
  // onto. The far one (comet-d, also 5 minutes) swings out to 376 m, past the far planet's path. shape: each
  // is a lumpy potato inside its radius (sim/shape.js: squash, the half-axes as shares of the radius; dents,
  // how many hollows, their depth and width ranges; seed lays them out), so the radius still bounds it.
  { id: "comet-a", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, shape: { seed: 1, squash: [1, 0.8, 0.74], dents: 6, depth: [0.06, 0.15], width: [0.06, 0.16] }, orbit: { around: "sun", peri: 34.8, apo: 208.1, period: 80, phase: 0.317, inc: 24.4, node: 142, arg: 307, kepler: 0.41 }, color: 0xbfe8ff },
  { id: "comet-b", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, shape: { seed: 2, squash: [0.78, 1, 0.82], dents: 7, depth: [0.05, 0.14], width: [0.05, 0.14] }, orbit: { around: "sun", peri: 41.2, apo: 202.2, period: 80, phase: 4.388, inc: 21.1, node: 281, arg: 246, kepler: 0.28 }, color: 0xbfe8ff },
  { id: "comet-c", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, shape: { seed: 3, squash: [0.8, 0.76, 1], dents: 5, depth: [0.07, 0.15], width: [0.07, 0.18] }, orbit: { around: "sun", peri: 74.2, apo: 222.5, period: 300, phase: 2.576, inc: 10.1, node: 87, arg: 333, kepler: 0.34 }, color: 0xbfe8ff },
  { id: "comet-d", kind: "comet", radius: 3, g: 2, reach: 5.25, hold: 3, shape: { seed: 4, squash: [1, 0.86, 0.76], dents: 7, depth: [0.05, 0.13], width: [0.05, 0.15] }, orbit: { around: "sun", peri: 44, apo: 375.6, period: 300, phase: 5.435, inc: 14.9, node: 287, arg: 289, kepler: 0.26 }, color: 0xbfe8ff },
];

// Looks only, no collisions or gravity: you fly straight through both. The giant's `ring` is in multiples
// of its radius, tilted `tilt` degrees from the orbital plane. The belt is a band of rocks round the sun
// between the mid and heavy planets' paths (radii in m, `size` the range of rock sizes in m, one lap per
// `period` s).
export const BELT = { inner: 148, outer: 160, thick: 4, rocks: 500, size: [0.4, 1.8], period: 260 };

// Asteroids: one breaks off the belt every `every` s (the owner's choice) and falls in under the usual gravity (asteroids.js).
// radius: m, about twice a player's height across; speed: m/s range off the belt, in a direction up to
// `tilt` degrees above or below the orbital plane, where the planets are, and up to `aim` degrees either side
// of straight at the sun. Kicked any way at all (aim 180) only a quarter reach the sun: the heavy planet,
// just outside the belt, outpulls the sun there and catches a third of them. At 25 about half burn in the
// sun and a third land on a planet or moon (tests/asteroids.test.mjs). clear: m of room beyond touching a
// body a launch needs, so a body moving in can't meet it on its first tick; life: s before one that missed
// everything is dropped. blast as the rocket's, a little bigger.
export const ASTEROID = {
  every: 5, radius: 1.8, speed: [8, 16], tilt: 20, aim: 25, clear: 2, life: 120,
  blast: { splash: 5, damage: 90, knockback: 18, self: 0.5 },
};

// s; every orbit period divides it, so the whole system repeats exactly and can be checked over one cycle.
export const CYCLE = 25200;
// close: metres between a comet's and a planet's surfaces that count as a close pass (a chance to hop on or off).
export const COMET = { close: 10 };

export const PLAYER = {
  radius: 0.5, // movement and ground contact sphere, centred radius above the feet
  // Shots test these two spheres, the figure as drawn (metres along up from the feet). The head is the
  // bubble helmet's outer shape, its top at 1.8 m.
  hit: { body: { at: 0.4, r: 0.4 }, head: { at: 1.25, r: 0.55 } },
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

// Weapons, keyed by name. type: "bullet" (falls with gravity), "rocket" (bullet that explodes) or "ray"
// (instant and straight). spread: half-angle of the cone in degrees. ammo: { pickup: rounds a weapon pickup
// gives, box: rounds an ammo box gives, max: the most you carry }; null means unlimited (the pistol).
// Rocket: splash damage and knockback fall off linearly to zero at `splash`, measured to the nearer hit sphere
// centre; `self` scales damage to the shooter.
export const WEAPONS = {
  pistol: { type: "bullet", speed: 120, damage: 10, cooldown: 0.35, spread: 0, ammo: null },
  shotgun: { type: "bullet", speed: 120, damage: 10, cooldown: 0.9, spread: 6, pellets: 10, range: 35, push: 0.8, ammo: { pickup: 8, box: 8, max: 24 } },
  rocket: { type: "rocket", speed: 30, damage: 90, cooldown: 0.9, spread: 0, splash: 4, knockback: 15, self: 0.5, showFor: 0.5, ammo: { pickup: 5, box: 5, max: 15 } },
  minigun: { type: "bullet", speed: 120, damage: 6, cooldown: 0.08, spread: 0.8, ammo: { pickup: 100, box: 80, max: 300 } },
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

// Solar flares (sim/flares.js). Flare k warns at first + k * every, give or take jitter (s), so the first comes
// 60 to 90 s in and warnings are 60 to 120 s apart. warn: s of warning before the burst; burn: s it burns;
// fade: s its look takes to die away after, harmless. Anyone in the sun's light burns at rate health/s
// within full m of the sun's centre, falling linearly to nothing at reach m: Hot and Tiny full, Mid less.
// hover: m above a body within which its night side still shelters you (a hop, a push, a low boost).
export const FLARE = { first: 75, every: 90, jitter: 15, warn: 10, burn: 6, fade: 3, rate: 25, full: 80, reach: 150, hover: 4 };

// One per player slot; index 0 is the solo player's.
export const COLOURS = [0xffd23f, 0xe8505b, 0x4fb0e8, 0x6fd36b, 0xb06fe8, 0xff8a3d, 0x3fd9c4, 0xf08bc8];

// What being hit and kills look like (seconds unless noted). Looks only. Vignette: full strength at `full`
// damage, never above `max`; the bar over a hit player flashes white for `flash`.
// Looks of a flying asteroid: `trail` drawn positions kept behind it, `glow` the hot haze's radius as a
// multiple of the rock's and `glowOpacity` how solid it is, `trailSize` the m across of each trail
// dot, colours as hex. heat: the trail shows only while the rock falls in on a body (closing on it), like a
// meteor: none beyond heat[0] m from the surface, full within heat[1] m.
export const ROCK_LOOK = { trail: 60, trailSize: 1.6, glow: 1.3, glowOpacity: 0.25, rock: 0x3a3330, hot: 0xff7a1f, trailColor: 0xffa040, heat: [30, 10] };

// Sound, looks only. range: m beyond which nothing is heard; near: m within which a sound is at full volume;
// own, others: gains for your sounds and everyone else's; gap: s of frame or clock jump after which changes
// are only remembered, not played (a frame that long drops its events too: a hidden tab coming back);
// stride: m walked per footstep; stepSpeed: m/s below which walking is silent; maxVoices at once; repeat: s
// between two plays of one name from one source; announcerOthers: the gain of a sun kill that isn't yours;
// hold: s a booster hiss outlasts the last fuel drop seen, as others' fuel arrives in steps with the
// snapshots; voice: s a sound counts as playing until it reports its real end (the longest one-shot); master:
// the overall gain before the compressor; maxLoops: loops at once, the nearest kept (a swarm of rockets stays
// a few hisses); loopKeep: m nearer a new loop must be to take a playing one's place at the cap, so two at
// nearly the same distance don't swap every frame.
export const SOUND = {
  range: 120, near: 6, own: 1, others: 0.7, gap: 0.5, stride: 1.6, stepSpeed: 2, maxVoices: 24, repeat: 0.05,
  announcerOthers: 0.4, hold: 0.15, voice: 1.5, master: 0.8, maxLoops: 8, loopKeep: 5,
  flareVoiceAfter: 1.4, // s after a flare's alarm starts that the voice speaks, once the alarm is done
};

export const FEEDBACK = { vignetteFade: 0.4, vignetteMax: 0.7, full: 50, arcFade: 1, feedFor: 5, flash: 0.15, feedMax: 6 };

// The look, looks only. budget: bytes the page may download for all look assets (tools/look_check.cjs).
// quality, the automatic step (look/quality.js): a level down when frames average over `down` s across a
// `window` s, a level up after `up` s of windows that weren't; a frame over `pause` s is a hidden tab coming
// back, not a slow frame, but a run of them is a very slow machine. Each time a level fails, the wait to
// climb back into it doubles, up to `maxUp` s, so a machine fast one level down settles there; holding the
// level for `maxUp` s trusts it again. res: the share of the screen's own resolution drawn at each level, lowest
// first, of at most `most` pixels per CSS pixel (a 3x screen doesn't cost 9 pixels each), but never under one
// device pixel per CSS pixel (look/quality.js pixelRatio): a 2x screen draws 1, 1.5 and 2, a 1x screen 1 at
// every level.
// sky (look/sky.js), painted once at load into a cube map of `size` px a face: intensity scales it all (dim,
// so players and asteroids stand out); stars: the share of texels holding a faint distant star behind the
// drawn ones. Each nebula: the direction it lies in, its size (radians), the two colours it shades between
// and a seed for its shape. galaxy: its direction, size (radians to the disc's edge), tilt (degrees from
// face on) and turn (degrees round the line of sight).
// sun (look/sun.js): octaves of churn on the surface and of the corona's streamers at each quality level;
// churn: how fast the surface moves; corona: how far it reaches, in sun radii; flare: the screen glow's
// strength looking straight at the sun, drawn from level `flareFrom` up; fade: 1/s, how fast the glow
// follows the sun going behind a planet.
// planets (look/planets.js): bake, the cube map's px a face painted at load per planet and moon (a world's own
// `bake` overrides it); detail, the close-up layer at each quality level (0 off, 1 one layer, 2 all); near,
// far: m from the eye where it is full and gone. sun, light: the sunlight's colour and strength on the ground;
// night, nightLight: the faint light on the night side (dark but never black). blob: the soft shadow under
// figures and pickups, darkest `strength` on the ground, gone `fade` m up, widening by `spread` per m; at most
// `max` at once. Each world: its kind, a seed for its shapes, relief (m of painted height, for the lighting
// only), its colours (darkest or main first; see the kind's paint function for each one's role), glow (lava,
// the island's lights), rim (the haze round its lit edge from afar) and feature (the island, the great
// storm). Quick to change after a look: colours here, shapes in planets.js.
// alien (look/aliens.js, the model from tools/blender/alien.py): suit, the suit colour for everyone; dummy, the
// dummy's skin and trim; trim, how bright the suit's trim glows in the player's colour (what shows a figure on
// a night side); rim, the bubble's glow at its edge in the same colour; sun, the sunlight on figures as a share
// of the scene's sun light (figures use the same light as pickups, too strong for a white suit); hold, the
// gun's size in the hand against the model's own. pose (look/alienpose.js), radians unless noted: steps,
// strides per s at a walk (one rate at any speed, so a speed change never jumps the stride); swing, armSwing:
// how far legs and the free arm swing at full run; head: the most the head tips with the aim; aim: the range
// the gun arm follows the aim in (beyond it the arm would pass through the bubble); support: the free arm
// against the gun arm; reach: the hook arm above the aim; lean when walking (at full run), just jumped, falling
// and boosting (the body leans about the head, so a lean over about 0.12 takes the drawn torso off its hit
// sphere: boosting reads from the trailing legs instead); tuck and dangle: the legs (left, right) just after a
// jump and after `fall` s in the air; trail: the legs while boosting; fly: the free arm while boosting; flail:
// the free arm while falling; ease: s, how fast a pose follows its state; boostHold: s a boost pose outlasts
// the last fuel drop seen. jet: the booster's flames while boosting, one per nozzle (unlit, so they read on a
// night side and from afar): core, the white-hot inside; length, width: the flame in m; coreShare: the core's
// length and width against the flame's; tilt: rad the flames point back from straight down; flicker: how much
// the length wavers, at `rate` rad/s; opacity, the flame's at the nozzle (it fades to none at the tip); glow:
// the light round each nozzle, m across and opacity; ease: s to light or go out; trail: the exhaust left
// behind, in game ticks (a point each), trailSize: m across each point, trailGlow: its brightness at the
// nozzle.
// weapons (look/weapons.js, the models from tools/blender/weapons.py; look/gunpose.js): colors, each weapon's
// accent, its pickup's colour too (the .glb is built with the same, tests/look.test.mjs); glow, how bright an
// accent glows in its own colour (so a gun reads on a night side); sun, as alien.sun for the gun in view;
// view, where the grip sits in the camera's frame (m: right, up, back), scale, the gun's size there (smaller
// and further out than life, so a long gun neither reaches past the near plane nor swells up close; it points
// straight ahead, so its barrel runs to the crosshair); kick: the recoil after each of your shots, back (m) and up (rad) at its start,
// gone after `time` s, scaled per weapon by `by`; flash: s a muzzle flash shows, its size per weapon (m, in the
// model's own size) and its colour; spin: the minigun's barrels, rad per s while firing and for `for` s after.
// thrust (look/gunpose.js): your own boost in first person, easing in and out over `ease` s: fov, degrees the
// view widens (small: a big change in view width makes some people queasy); dip, m the gun in view drops;
// shake, m it shakes at `shakeRate` rad/s; glow, how strong the light of your flames is from below the screen.
// props (look/props.js, the models from tools/blender/props.py; look/proppose.js): pickups float `float` m over
// their spot, bobbing `bob` m at `bobRate` rad/s, turning `spin` rad/s; glow: how bright their coloured parts
// glow in their own colour; night: how much the rest glows in its own colour where the sun doesn't reach (so a
// pickup on a night side keeps a soft glow), nightTint: and in the pickup's colour at full brightness (so a dark
// part does too); halo: the soft light round one, m across and opacity; sun:
// as alien.sun; weapon: a gun pickup's size against the gun in view. pads: the plate's lights, by cue (lands,
// misses, cues hidden), how bright they glow, and the halo over the plate. rocks: the belt's colour and how much
// one rock's shade differs from the next (a share of it); cracks: how bright a flying rock's hollows glow in ROCK_LOOK.hot;
// rim: the hot edge round it. comets: each tail's colour, length [base, reach, most] (m: base + reach / the
// distance to the sun, at most `most`), width at the comet and at the tip (m) and opacity; the dust tail's bend
// (m sideways per m along, at its tip), trailing the comet's path. stir: m from the sun within which a comet
// is fully stirred (less further out: stir / distance), which grows its coma and jets; coma: the haze round
// it, its colour, size (m across, as multiples of its radius, still and fully stirred), opacity (the same) and
// fade (m from its surface, the eye's distance over which it fades in, so it never fogs the view on it); jets:
// `count` plumes of gas from its sunlit side, colour, length (m, still and fully stirred), width (m across at
// the end), opacity, sunward (a vent blows fully once the sun is this high over it, as the cosine, and fades
// out to sunset) and back (how much a plume bends away from the sun, into the tails).
export const LOOK = {
  budget: 4_000_000,
  weapons: {
    colors: { pistol: 0x8fa1b8, shotgun: 0xc98a4b, rocket: 0x5f8f4e, minigun: 0x9a9fa8, sniper: 0x4b7bc9, railgun: 0x3fe0d0 },
    glow: 0.35, sun: 0.45,
    view: [0.2, -0.22, -0.46], scale: 0.95,
    kick: { time: 0.16, back: 0.035, up: 0.1, by: { pistol: 1, shotgun: 1.6, rocket: 1.4, minigun: 0.35, sniper: 1.8, railgun: 1.5 } },
    flash: {
      time: 0.06,
      size: { pistol: 0.16, shotgun: 0.32, rocket: 0.36, minigun: 0.2, sniper: 0.3, railgun: 0.26 },
      color: { pistol: 0xffd27a, shotgun: 0xffb45a, rocket: 0xff9a40, minigun: 0xffe08a, sniper: 0xfff0b0, railgun: 0x7ff6ff },
    },
    spin: { speed: 30, for: 0.3 },
  },
  alien: {
    suit: 0xe8ebf0, dummy: 0x8a8e94, trim: 0.9, rim: 0.8, sun: 0.45, hold: 1.6,
    pose: {
      steps: 2.6, swing: 0.6, armSwing: 0.35, head: 0.5, aim: [-1.3, 0.7], support: -0.35, reach: 0.4,
      lean: { walk: 0.08, jump: -0.08, fall: 0.1, boost: 0.11 },
      tuck: [0.75, -0.2], dangle: [0.35, -0.35], trail: [-0.7, -0.6], fly: 1.8, flail: 2.4, fall: 0.6, ease: 0.08, boostHold: 0.15,
    },
    jet: { core: 0xfff4dc, length: 1.1, width: 0.11, coreShare: [0.5, 0.45], tilt: 0.45, flicker: 0.2, rate: 31, opacity: 1, glow: [1.1, 0.7], ease: 0.05, trail: 24, trailSize: 0.45, trailGlow: 0.55 },
  },
  thrust: { ease: 0.06, fov: 4, dip: 0.02, shake: 0.004, shakeRate: 43, glow: 0.6 },
  props: {
    pickups: { float: 1, bob: 0.15, bobRate: 2, spin: 1, glow: 0.6, night: 0.3, nightTint: 0.06, halo: [1.8, 0.5], sun: 0.55, weapon: 2.2 },
    pads: { lands: 0x3ee05a, misses: 0xe0443e, hidden: 0x8a8f9c, glow: 1.2, halo: [2.6, 0.3] },
    rocks: { belt: 0x34302d, variety: 0.3, cracks: 1.6, rim: 0.4 },
    comets: {
      ion: { color: 0x5fa8ff, length: [12, 2400, 80], width: [0.7, 1.4], opacity: 0.55 },
      dust: { color: 0xffe6a8, length: [8, 1500, 50], width: [2.2, 10], opacity: 0.55, bend: 0.5 },
      stir: 40,
      coma: { color: 0xcfeaff, size: [3.5, 7], opacity: [0.35, 0.85], fade: [2, 10] },
      jets: { count: 3, color: 0xe2f4ff, length: [1.5, 9], width: 1.6, opacity: 0.6, sunward: 0.25, back: 0.6 },
    },
  },
  quality: { down: 1 / 50, up: 10, window: 2, pause: 0.25, maxUp: 240, res: [0.5, 0.75, 1], most: 2 },
  sky: {
    size: 1024, intensity: 1, stars: 0.004,
    nebulas: [
      { dir: [-0.55, 0.12, -0.83], size: 0.95, colors: [0x5b2c9e, 0x2b63c4], seed: 1 },
      { dir: [0.85, -0.2, 0.45], size: 0.8, colors: [0x13807e, 0x2d4fa8], seed: 2 },
      { dir: [0.15, 0.5, 0.85], size: 0.7, colors: [0xd0601c, 0x962a5c], seed: 3 },
      { dir: [-0.2, -0.85, -0.2], size: 0.75, colors: [0x24308c, 0x8c2f7a], seed: 4 },
    ],
    galaxy: { dir: [0.5, 0.82, 0.05], size: 0.2, tilt: 60, turn: 25 },
  },
  sun: { octaves: [2, 3, 5], streamers: [2, 4, 4], churn: 0.06, corona: 3.2, flare: 0.5, flareFrom: 1, fade: 8, light: 7 },
  // A solar flare as seen (look/solarflare.js), on FLARE's schedule. rise: s to full brightness at the burst;
  // dim: s it takes to dim once the burn ends;
  // cloudFrom: the lowest quality level that draws the plasma cloud. Units of `arches` are sun radii: span (half the gap between the feet) and height
  // ranges, tube thickness, spread of the feet round the patch, sink (feet a hair under the surface), hot
  // (heat at the burst; over 1 is white), snap (how much they jump at the burst), bright (overall gain).
  // beacon: a glow over each patch (sun radii) that reads from afar. second: the smaller set of arches, `apart`
  // degrees round the sun from the main set, so everyone sees one (size: its share of the main set's; glow: its
  // patch's brightness). swell: the sun grows by this
  // share; corona, coronaBoost: its reach and brightness grow; glare: the glare in the eye grows; bleach:
  // sunlight brightens by this share (and whitens); flash: the whole view whitens for `time` s in its light.
  // wave: a shell of light running out to `reach` m in `time` s. cloud: the plasma cloud's puffs, cone (radians
  // round the patch), speed m/s, size m from start to end, colours.
  flare: {
    rise: 0.25, dim: 0.5, cloudFrom: 1,
    arches: { count: 11, span: [0.08, 0.22], height: [0.2, 0.7], thick: 0.03, spread: 0.12, sink: 0.995, hot: 1.8, snap: 0.35, bright: 4 },
    beacon: { size: 1.4, lift: 0.25, opacity: 1, color: 0xffb060 },
    second: { size: 0.6, count: 7, glow: 0.8, apart: 135 },
    swell: 0.08, corona: 0.6, coronaBoost: 1.5, glare: 1.5, bleach: 0.8,
    flash: { time: 1.2, strength: 0.6 },
    wave: { reach: 160, time: 1.6, strength: 0.3 },
    tint: { opacity: 0.55, pulse: 3 }, // the screen's orange glow while it burns you: strongest, pulses a second
    cloud: { puffs: 40, cone: 0.35, speed: [14, 30], size: [10, 45], opacity: 0.55, color: 0xff7a2a, hot: 0xffd890 },
  },
  planets: {
    bake: { planet: 512, moon: 256, comet: 256 },
    detail: [0, 1, 2],
    near: 8, far: 22,
    sun: 0xfff1d6, light: 1.35, night: 0x8090c0, nightLight: 0.08,
    blob: { strength: 0.65, fade: 5, spread: 0.3, max: 16 },
    worlds: {
      hot: { world: "lava", seed: 1, relief: 0.6, colors: [0x1a1412, 0x3b2f2a, 0x5c2617, 0xff7a20], glow: 0xff5a12, rim: 0xff6a3a },
      tiny: { world: "jungle", seed: 2, relief: 0.9, colors: [0x163d16, 0x2f7a26, 0x8cbf3a, 0x1f5f66, 0x8a7448], rim: 0x9fe8b8 },
      mid: {
        world: "ocean", seed: 3, relief: 0.3, feature: [0.35, 0.55, 0.76],
        colors: [0x0f4f8c, 0x1fb4c8, 0x9fe6d2, 0xf2e2a8, 0xc9b27a, 0x2a7a6a], glow: 0xffb860, rim: 0xa8e4ff,
      },
      heavy: { world: "desert", seed: 4, relief: 1.2, bake: 1024, colors: [0xe8a868, 0xc87a3e, 0xa8482a, 0x4e1e14, 0xf2dcb4], rim: 0xffb478 },
      giant: {
        world: "gas", seed: 5, relief: 0, feature: [0.82, -0.28, 0.5],
        colors: [0x4c3590, 0x8f74da, 0xe2d4f4, 0xb862a6, 0x261a58, 0xf0909a], rim: 0xc8a8ff,
        ring: { colors: [0xcbb8f0, 0x9a86c8, 0xe8dcc8], opacity: 0.85 },
      },
      far: { world: "ice", seed: 6, relief: 0.25, colors: [0xeef8fc, 0x9ed8e2, 0x2f78c0, 0xffffff, 0x6fd3c9], rim: 0xb0fff4, aurora: [0x3cff9c, 0x8a5aff] },
      moon: { world: "rock", seed: 7, relief: 0.6, craters: 1, colors: [0x9a948c, 0xc4beb4, 0x5c5854] },
      "mid-moon": { world: "rock", seed: 8, relief: 0.5, craters: 0.7, colors: [0x8e98a2, 0xbcc6cf, 0x4e5862] },
      "ring-moon": { world: "rock", seed: 9, relief: 0.5, craters: 1.3, colors: [0x9c94aa, 0xc8bfd6, 0x5a5268] },
      "outer-moon": { world: "rock", seed: 10, relief: 0.6, craters: 0.85, colors: [0xa69e86, 0xd2c8aa, 0x625a46] },
      // Comets: crust (dark, light), ice (bright, blue), deep dust; craters here sets the pits' size.
      "comet-a": { world: "comet", seed: 11, relief: 0.5, craters: 1, colors: [0x48505c, 0x6c7480, 0xe4f4ff, 0x8cc8e8, 0x262a32], rim: 0xbfe8ff },
      "comet-b": { world: "comet", seed: 12, relief: 0.5, craters: 1.3, colors: [0x4e4a56, 0x76707e, 0xeef0ff, 0x9fb4f0, 0x2a2630], rim: 0xc8d4ff },
      "comet-c": { world: "comet", seed: 13, relief: 0.6, craters: 0.8, colors: [0x4a5250, 0x707a76, 0xe6fff8, 0x84d8cc, 0x262c2a], rim: 0xb8fff0 },
      "comet-d": { world: "comet", seed: 14, relief: 0.5, craters: 1.1, colors: [0x544c48, 0x7c726a, 0xfff6ea, 0xb8d4e8, 0x2e2826], rim: 0xe0ecff },
    },
  },
};

// Online play. Ticks unless noted: maxLag, history, rejoin, unreachable and smooth are seconds, snap is metres.
export const NET = {
  maxPlayers: 8, snapEvery: 2, interp: 6, slack: [2, 5], hold: 15, maxAhead: 60, maxLag: 0.5, history: 0.6,
  rejoin: 10, unreachable: 30, smooth: 0.1, snap: 4, resync: 60, lead: 6, nameMax: 16,
};

// Pads: `dir` is the launch direction in world axes (nothing spins); the pad sits on its body out along
// `dir`. heading(a, el) is the unit vector at `a` degrees round the
// orbital plane (from +x towards +z) and `el` degrees above it. The layout was searched so every pad has a
// launch window of at least 5 s and every planet has one at least once a minute (tests/pads.test.mjs).
// Speed is per planet, a little above what it takes to leave it: heavier planets need faster pads. The
// giant's outer moon is the only moon with pads: 22 m/s also leaves the giant's pull, so its two opposite
// pads reach the far and heavy planets as well as the giant and its ring-moon.
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
  { id: "outer-moon-a", body: "outer-moon", dir: heading(120), speed: 22 },
  { id: "outer-moon-b", body: "outer-moon", dir: heading(300), speed: 22 },
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
// Moons carry no weapons, only health, fuel or ammo, so they are detours rather than new routes.
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
  { id: "mid-moon-health", body: "mid-moon", dir: heading(0, 40), kind: "health" },
  { id: "mid-moon-minigun-ammo", body: "mid-moon", dir: heading(180, -40), kind: "ammo", weapon: "minigun" },
  { id: "giant-minigun", body: "giant", dir: heading(30, 40), kind: "weapon", weapon: "minigun" },
  { id: "giant-health", body: "giant", dir: heading(150, -40), kind: "health" },
  { id: "giant-health-2", body: "giant", dir: heading(270, 50), kind: "health" },
  { id: "giant-fuel", body: "giant", dir: heading(90, -50), kind: "fuel" },
  { id: "giant-rocket-ammo", body: "giant", dir: heading(210, 35), kind: "ammo", weapon: "rocket" },
  { id: "giant-sniper-ammo", body: "giant", dir: heading(330, -35), kind: "ammo", weapon: "sniper" },
  { id: "giant-railgun-ammo", body: "giant", dir: heading(0, 60), kind: "ammo", weapon: "railgun" },
  { id: "ring-moon-health", body: "ring-moon", dir: heading(0, 40), kind: "health" },
  { id: "ring-moon-rocket-ammo", body: "ring-moon", dir: heading(180, -40), kind: "ammo", weapon: "rocket" },
  { id: "outer-moon-health", body: "outer-moon", dir: heading(30, 50), kind: "health" },
  { id: "outer-moon-fuel", body: "outer-moon", dir: heading(210, -50), kind: "fuel" },
  { id: "far-sniper", body: "far", dir: heading(0, 50), kind: "weapon", weapon: "sniper" },
  { id: "far-sniper-ammo", body: "far", dir: heading(180, -50), kind: "ammo", weapon: "sniper" },
];

// touch: feet within this of a pad launch; lockout: no relaunch for this long.
export const PAD = { touch: 1.2, lockout: 1 };
// pathEvery: keep one predicted point every this many ticks for drawing.
export const PAD_CUE = { refresh: 0.25, predict: 20, showPathWithin: 15, pathEvery: 6 };

// mouse: radians of turn per pixel of mouse movement.
export const CONTROLS = { mouse: 0.0022 };
