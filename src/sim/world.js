// The whole simulation: bodies on the clock, entities, asteroids, solar flares, deaths in the sun and the void, respawns,
// and the fixed 60 Hz tick driven from real elapsed time.
import { createSystem, posesAt } from "./system.js";
import { createEntity, standOn, stepEntity, hitCentre, NO_INPUT } from "./entity.js";
import { surfaceInfo, sphereContacts } from "./collide.js";
import { radiusAt, normalAt } from "./shape.js";
import { padPos, touchPads, refreshCues } from "./pads.js";
import { fire, stepProjectiles } from "./weapons.js";
import { record } from "./lag.js";
import { stepPickups } from "./pickups.js";
import { stepHook } from "./hook.js";
import { stepAsteroids } from "./asteroids.js";
import { stepFlare, flareAt, exposure } from "./flares.js";
import { add, scale, dist, norm, anyPerpendicular } from "./vec.js";

// Spawn candidates: an evenly spread, fixed list of directions (Fibonacci sphere).
const SPAWN_DIRS = Array.from({ length: 48 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 48, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(a), y, r * Math.sin(a)];
});

function candidates(world, body) {
  const c = world.poses[body.id].pos;
  return SPAWN_DIRS.map((u) => ({ pos: add(c, scale(u, radiusAt(body, u))), up: normalAt(body, u) }));
}

// A point on bodyId's surface clear of pads and other bodies, and far from the other entities: at least
// PLAYER.spawnFromOther, or as far as the body allows (the tiny planet is smaller than that). `gap` is the
// distance to the nearest other alive entity, so a caller can compare bodies.
// Tries candidates in a fixed order, starting further along after each spawn, so the same world always
// gives the same point but respawns don't all land on one spot. During a flare's warning or burn only spots
// out of its reach count (`safe`), unless there are none: dying again at once, with no time to react, is unfair.
export function spawnGap(world, bodyId, forId = null, safe = flareSafe(world, bodyId)) {
  const body = world.system.byId[bodyId];
  const all = candidates(world, body), list = safe ? all.filter(safe) : all;
  return list.length ? pickSpawn(world, list, forId) : pickSpawn(world, all, forId);
}

function flareSafe(world, bodyId) {
  const phase = flareAt(world.t, world.tuning.FLARE).phase;
  if (phase !== "warn" && phase !== "burn") return null;
  return (cand) => exposure(world, { pos: cand.pos, up: cand.up, groundId: bodyId }) === 0;
}

function pickSpawn(world, list, forId) {
  const { PLAYER } = world.tuning;
  const pads = world.pads.map((p) => padPos(world, p, world.poses));
  const others = Object.values(world.entities).filter((e) => e.alive && e.id !== forId);
  const start = (world.spawns * 7) % list.length;
  const gapAt = (pos) => Math.min(Infinity, ...others.map((e) => dist(e.pos, pos)));
  let best = null, bestGap = -1;
  for (let k = 0; k < list.length; k++) {
    const cand = list[(start + k) % list.length];
    if (pads.some((p) => dist(p, cand.pos) < PLAYER.spawnFromPad)) continue;
    const centre = add(cand.pos, scale(cand.up, PLAYER.radius));
    if (sphereContacts(world.system, world.poses, centre, PLAYER.radius).some((c) => c.depth > 1e-6)) continue;
    const gap = gapAt(cand.pos);
    if (gap >= PLAYER.spawnFromOther) return { pos: cand.pos, up: cand.up, gap };
    if (gap > bestGap) (best = cand), (bestGap = gap);
  }
  return best ? { pos: best.pos, up: best.up, gap: bestGap } : { ...list[0], gap: gapAt(list[0].pos) };
}

export function spawnPoint(world, bodyId, forId = null) {
  const { pos, up } = spawnGap(world, bodyId, forId);
  return { pos, up };
}

// The simulation's only randomness (weapon spread), seeded so every run, and later every machine, agrees.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Solo players respawn on PLAYER_BODY and the dummy on its own body. Online players get a random central
// body, and if someone is too close there, whichever other central body leaves the biggest gap.
function placeOnline(world, e) {
  const { SPAWN_BODIES, PLAYER } = world.tuning;
  const first = SPAWN_BODIES[Math.floor(world.rand() * SPAWN_BODIES.length)];
  let best = { ...spawnGap(world, first, e.id), body: first };
  if (best.gap >= PLAYER.spawnFromOther) return best;
  for (const body of SPAWN_BODIES) {
    if (body === first) continue;
    const s = spawnGap(world, body, e.id);
    if (s.gap > best.gap) best = { ...s, body };
  }
  return best;
}

function spawn(world, e) {
  const { DUMMY, PLAYER_BODY } = world.tuning;
  const at = e.kind === "dummy" ? { body: DUMMY.body } : world.solo ? { body: PLAYER_BODY } : null;
  const { pos, up, body } = at ? { ...spawnPoint(world, at.body, e.id), body: at.body } : placeOnline(world, e);
  world.spawns++;
  // `shots` survives a respawn, like the scores: bullets of the last life may still be flying under those ids.
  Object.assign(e, createEntity(e.id, e.kind, pos, up), { prev: null, shots: e.shots });
  standOn(e, body);
}

// The solo world is the original: a dummy and "player". An online world (the server's) starts empty;
// addPlayer and removePlayer keep the dummy while exactly one player is in it.
export function createWorld(tuning, { solo = true } = {}) {
  const system = createSystem(tuning.BODIES);
  const poses = posesAt(system, 0);
  const world = {
    tuning, system, t: 0, tick: 0, poses, prevPoses: poses, entities: {}, projectiles: [], explosions: [], beams: [],
    pads: tuning.PADS, cues: {}, events: [], history: [], spawns: 0, rand: seeded(1), pickups: {}, asteroids: [], rocksLaunched: 0,
    solo, players: {}, scores: {}, noCues: !solo, // the server has no use for pad cues
  };
  if (solo) {
    for (const [id, kind] of [["dummy", "dummy"], ["player", "player"]]) {
      world.entities[id] = createEntity(id, kind, [0, 0, 0], [0, 1, 0]);
      spawn(world, world.entities[id]);
    }
    world.players.player = { name: "You", colour: tuning.COLOURS[0] };
    world.scores.player = { kills: 0, deaths: 0 };
  }
  return world;
}

// The dummy is there to shoot at while you are alone: exactly one player means a dummy.
function dummyRule(world) {
  if (world.solo) return;
  const n = Object.keys(world.players).length;
  if (n === 1 && !world.entities.dummy) {
    world.entities.dummy = createEntity("dummy", "dummy", [0, 0, 0], [0, 1, 0]);
    spawn(world, world.entities.dummy);
  } else if (n !== 1) delete world.entities.dummy;
}

// A reconnecting player's score is put back before addPlayer, so it is only started when missing.
export function addPlayer(world, id, { name, colour }) {
  const e = createEntity(id, "player", [0, 0, 0], [0, 1, 0]);
  world.entities[id] = e;
  world.players[id] = { name, colour };
  world.scores[id] ||= { kills: 0, deaths: 0 };
  spawn(world, e);
  dummyRule(world);
  return e;
}

export function removePlayer(world, id, { keepScore = false } = {}) {
  delete world.entities[id];
  delete world.players[id];
  if (!keepScore) delete world.scores[id];
  dummyRule(world);
}

// Who gets the kill for e's death: the last player who hurt it, if they are still in the game.
export const creditOf = (world, e) => (e.lastHitBy && e.lastHitBy in world.scores ? e.lastHitBy : null);

function die(world, e, cause) {
  const by = creditOf(world, e), pos = hitCentre(e);
  e.alive = false;
  e.hook = null;
  e.respawnAt = world.t + (e.kind === "dummy" ? world.tuning.DUMMY.respawn : world.tuning.PLAYER.respawn);
  world.events.push({ type: "death", id: e.id, cause, by, pos });
  // Dummy kills and deaths don't count; neither does a kill on yourself.
  if (e.kind === "player" && world.scores[e.id]) {
    world.scores[e.id].deaths++;
    if (by && by !== e.id) world.scores[by].kills++;
  }
  // Sun and damage deaths burst like a rocket (looks only); the void just swallows you.
  if (cause !== "void") world.explosions.push({ pos: [...pos], age: 0 });
}

// The clock alone. A predicting client starts from the server's `t` and adds dt, never `tick * TICK`,
// so both sides get the same floats.
export function tickClock(world, dt) {
  world.prevPoses = world.poses;
  world.t += dt;
  world.tick++;
  world.poses = posesAt(world.system, world.t);
}

// One entity's tick, shared by the server's stepWorld and the browser's prediction of its own player.
export function stepPlayer(world, e, input, dt) {
  e.prev = { pos: e.pos, up: e.up }; // the renderer draws between this and the new state
  stepEntity(world, e, input, dt);
  stepHook(world, e, !!input.hook, dt);
  if (input.weapon && e.weapons.includes(input.weapon)) e.weapon = input.weapon;
  if (input.fire) fire(world, e, input.lag || 0);
  touchPads(world, e);
}

export function stepWorld(world, inputs, dt) {
  const { PLAYER, VOID_RADIUS } = world.tuning;
  tickClock(world, dt);
  const entities = Object.values(world.entities);
  for (const e of entities) {
    if (!e.alive) continue;
    stepPlayer(world, e, inputs[e.id] || NO_INPUT, dt);
  }
  stepPickups(world);
  stepProjectiles(world, dt);
  stepAsteroids(world, dt);
  stepFlare(world, dt);
  if (!world.noCues) refreshCues(world);

  const sun = world.system.bodies.find((b) => b.kind === "sun");
  const { KILL } = world.tuning;
  for (const e of entities) {
    if (!e.alive) continue;
    // A fall only stays the hitter's kill until you have stood a while and the hit is old.
    if (e.lastHitBy && e.groundTime >= KILL.standing && world.t - e.lastHitAt >= KILL.standing) e.lastHitBy = null;
    const c = hitCentre(e);
    if (dist(c, world.poses[sun.id].pos) < sun.radius + PLAYER.radius + 1e-6) die(world, e, "sun");
    else if (dist(c, world.poses[sun.id].pos) > VOID_RADIUS) die(world, e, "void");
    else if (e.health <= 0) die(world, e, e.flareTick === world.tick ? "flare" : "damage");
  }
  for (const e of entities) {
    if (e.alive || world.t < e.respawnAt) continue;
    spawn(world, e);
    world.events.push({ type: "respawn", id: e.id });
  }
  record(world);
}

// Look deltas, jumps and weapon picks belong to one moment, so only the first tick of a frame gets them.
const once = (input) => ({ ...input, yawDelta: 0, pitchDelta: 0, jump: false, weapon: null });

// Runs fixed ticks for real elapsed time and returns the time left over. A long gap (slow frame, hidden
// tab) runs at most MAX_TICKS and drops the rest rather than fast-forwarding the game to catch up.
export function advance(world, acc, elapsed, inputs) {
  const { TICK, MAX_TICKS } = world.tuning;
  acc += elapsed;
  let n = Math.floor(acc / TICK + 1e-9);
  if (n > MAX_TICKS) {
    n = MAX_TICKS;
    acc = n * TICK;
  }
  let later = null;
  for (let i = 0; i < n; i++) {
    stepWorld(world, i === 0 ? inputs : (later ||= Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, once(v)]))), TICK);
    acc -= TICK;
  }
  return Math.max(0, acc);
}
