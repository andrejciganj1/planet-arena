// The whole simulation: bodies on the clock, entities, deaths in the sun and the void, respawns, and
// the fixed 60 Hz tick driven from real elapsed time.
import { createSystem, posesAt } from "./system.js";
import { createEntity, standOn, stepEntity, hitCentre, NO_INPUT } from "./entity.js";
import { surfaceInfo, sphereContacts } from "./collide.js";
import { padPos } from "./pads.js";
import { fire, stepProjectiles } from "./weapons.js";
import { add, scale, dist, norm, anyPerpendicular } from "./vec.js";

// Spawn candidates: an evenly spread, fixed list of directions (Fibonacci sphere).
const SPAWN_DIRS = Array.from({ length: 48 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 48, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(a), y, r * Math.sin(a)];
});

function candidates(world, body) {
  const c = world.poses[body.id].pos;
  if (body.kind !== "station") return SPAWN_DIRS.map((u) => ({ pos: add(c, scale(u, body.radius)), up: u }));
  const [w, h, d] = body.size, out = [];
  for (let i = 1; i < 6; i++) for (let j = 1; j < 4; j++)
    out.push({ pos: [c[0] - w / 2 + (w * i) / 6, c[1] + h / 2, c[2] - d / 2 + (d * j) / 4], up: [0, 1, 0] });
  return out;
}

// A point on bodyId's surface clear of pads and other bodies, and for the player far from the others.
// Tries candidates in a fixed order, starting further along after each spawn, so the same world always
// gives the same point but respawns don't all land on one spot.
export function spawnPoint(world, bodyId, forId = null) {
  const { PLAYER } = world.tuning;
  const body = world.system.byId[bodyId];
  const list = candidates(world, body);
  const pads = world.pads.map((p) => padPos(world, p, world.poses));
  const others = Object.values(world.entities).filter((e) => e.alive && e.id !== forId);
  const start = (world.spawns * 7) % list.length;
  let best = null, bestGap = -1;
  for (let k = 0; k < list.length; k++) {
    const cand = list[(start + k) % list.length];
    if (pads.some((p) => dist(p, cand.pos) < PLAYER.spawnFromPad)) continue;
    const centre = add(cand.pos, scale(cand.up, PLAYER.radius));
    if (sphereContacts(world.system, world.poses, centre, PLAYER.radius).some((c) => c.depth > 1e-6)) continue;
    const gap = Math.min(Infinity, ...others.map((e) => dist(e.pos, cand.pos)));
    if (forId !== "player" || gap >= PLAYER.spawnFromOther) return { pos: cand.pos, up: cand.up };
    if (gap > bestGap) (best = cand), (bestGap = gap);
  }
  return best ? { pos: best.pos, up: best.up } : list[0];
}

const homeOf = (world, e) => (e.kind === "dummy" ? world.tuning.DUMMY.body : world.tuning.PLAYER_BODY);

function spawn(world, e) {
  const { pos, up } = spawnPoint(world, homeOf(world, e), e.id);
  world.spawns++;
  Object.assign(e, createEntity(e.id, e.kind, pos, up));
  standOn(e, homeOf(world, e));
}

export function createWorld(tuning) {
  const system = createSystem(tuning.BODIES);
  const poses = posesAt(system, 0);
  const world = {
    tuning, system, t: 0, tick: 0, poses, prevPoses: poses, entities: {}, projectiles: [], explosions: [],
    pads: tuning.PADS, cues: {}, events: [], spawns: 0,
  };
  for (const [id, kind] of [["dummy", "dummy"], ["player", "player"]]) {
    world.entities[id] = createEntity(id, kind, [0, 0, 0], [0, 1, 0]);
    spawn(world, world.entities[id]);
  }
  return world;
}

function die(world, e, cause) {
  e.alive = false;
  e.respawnAt = world.t + (e.kind === "dummy" ? world.tuning.DUMMY.respawn : world.tuning.PLAYER.respawn);
  world.events.push({ type: "death", id: e.id, cause });
}

export function stepWorld(world, inputs, dt) {
  const { PLAYER, VOID_RADIUS } = world.tuning;
  world.prevPoses = world.poses;
  world.t += dt;
  world.tick++;
  world.poses = posesAt(world.system, world.t);
  const entities = Object.values(world.entities);
  for (const e of entities) {
    if (!e.alive) continue;
    const input = inputs[e.id] || NO_INPUT;
    stepEntity(world, e, input, dt);
    if (input.weapon) e.weapon = input.weapon;
    if (input.fire) fire(world, e);
  }
  stepProjectiles(world, dt);

  const sun = world.system.bodies.find((b) => b.kind === "sun");
  for (const e of entities) {
    if (!e.alive) continue;
    const c = hitCentre(e);
    if (dist(c, world.poses[sun.id].pos) < sun.radius + PLAYER.radius + 1e-6) die(world, e, "sun");
    else if (dist(c, world.poses[sun.id].pos) > VOID_RADIUS) die(world, e, "void");
    else if (e.health <= 0) die(world, e, "damage");
  }
  for (const e of entities) {
    if (e.alive || world.t < e.respawnAt) continue;
    spawn(world, e);
    world.events.push({ type: "respawn", id: e.id });
  }
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
