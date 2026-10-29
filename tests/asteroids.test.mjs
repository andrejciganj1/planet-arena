import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld, addPlayer, tickClock } from "../src/sim/world.js";
import { fire, detonate, stepProjectiles } from "../src/sim/weapons.js";
import { launchOf, stepAsteroids } from "../src/sim/asteroids.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { createEntity, standOn, nearestSphere, worldVel } from "../src/sim/entity.js";
import { surfaceInfo, segmentHit } from "../src/sim/collide.js";
import { add, sub, scale, dist, norm, len, dot } from "../src/sim/vec.js";

const { TICK, ASTEROID, BELT, COLOURS } = tuning;

// A world with no entities: rocks come only from the clock.
const bare = () => createWorld(tuning, { solo: false });
const rock = (w, id, pos, vel = [0, 0, 0]) => {
  const r = { id, pos, vel, age: 0, owner: null };
  w.asteroids.push(r);
  return r;
};
const of = (w, type) => w.events.filter((x) => x.type === type);
// Two players, a parked on the heavy planet's far side and b standing on top of the mid planet.
function duel() {
  const w = { ...createWorld(tuning, { solo: false }), pads: [] };
  const a = addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  const b = addPlayer(w, "b", { name: "B", colour: COLOURS[2] });
  for (const [e, body, u] of [[a, "heavy", [0, -1, 0]], [b, "mid", [0, 1, 0]]]) {
    Object.assign(e, createEntity(e.id, e.kind, add(w.poses[body].pos, scale(u, w.system.byId[body].radius)), u));
    standOn(e, body);
  }
  return { w, a, b };
}
// A point in open space above the sun, far from every body at the start.
const SPACE = [0, 80, 0];

test("one launch every 15 s: 40 in the first 10 minutes, minus launches that would start inside a body", () => {
  const w = bare(), first = {};
  while (w.t < 600 + 0.5) {
    stepWorld(w, {}, TICK);
    for (const r of w.asteroids) first[r.id] ??= w.t;
  }
  assert.equal(ASTEROID.every, 15);
  assert.equal(w.rocksLaunched, 40);
  const expected = [];
  for (let k = 1; k <= 40; k++) if (launchOf(tuning, w.system, k)) expected.push(`rock.${k}`);
  assert.ok(expected.length >= 30, `${expected.length} of 40 launch`);
  assert.deepEqual(Object.keys(first).sort(), expected.sort());
  for (const id of expected) assert.ok(Math.abs(first[id] - Number(id.slice(5)) * ASTEROID.every) < TICK + 1e-6, id);
});

test("the same launch number gives the same rock, on any machine", () => {
  assert.deepEqual(launchOf(tuning, createSystem(tuning.BODIES), 7), launchOf(tuning, createSystem(tuning.BODIES), 7));
  const a = bare(), b = bare();
  for (const w of [a, b]) {
    while (w.t < 300) {
      stepWorld(w, {}, TICK);
      if (w === b && w.tick % 100 === 0) w.rand(); // online spawns draw from the world's dice; rocks must not care
    }
  }
  assert.ok(a.asteroids.length > 0);
  assert.deepEqual(a.asteroids.map((r) => r.id), b.asteroids.map((r) => r.id));
  for (let i = 0; i < a.asteroids.length; i++) {
    assert.deepEqual(a.asteroids[i].pos, b.asteroids[i].pos);
    assert.deepEqual(a.asteroids[i].vel, b.asteroids[i].vel);
  }
});

test("no launch point is inside or touching a body", () => {
  const system = createSystem(tuning.BODIES), w = (2 * Math.PI) / BELT.period;
  let launched = 0;
  for (let k = 1; k <= 2000; k++) {
    const L = launchOf(tuning, system, k);
    if (!L) continue;
    launched++;
    const t = k * ASTEROID.every, poses = posesAt(system, t);
    assert.equal(L.id, `rock.${k}`);
    for (const b of system.bodies) assert.ok(surfaceInfo(b, poses[b.id], L.pos).dist >= ASTEROID.radius, `${k} ${b.id}`);
    // Nor does its first tick reach one (the bodies move on meanwhile).
    const later = posesAt(system, t + TICK);
    assert.equal(segmentHit(system, later, L.pos, add(L.pos, scale(L.vel, TICK)), ASTEROID.radius), null, `${k} first tick`);
    // On the belt, and off it at a speed in range within `tilt` of the plane, relative to the belt's own turn.
    const r = Math.hypot(L.pos[0], L.pos[2]);
    assert.ok(r >= BELT.inner && r <= BELT.outer && Math.abs(L.pos[1]) <= BELT.thick / 2, `${k} on the belt`);
    const own = sub(L.vel, [-w * L.pos[2], 0, w * L.pos[0]]), s = len(own);
    assert.ok(s >= ASTEROID.speed[0] - 1e-9 && s <= ASTEROID.speed[1] + 1e-9, `${k} speed ${s}`);
    assert.ok(Math.abs(Math.asin(own[1] / s)) <= (ASTEROID.tilt * Math.PI) / 180 + 1e-9, `${k} tilt`);
    const off = Math.acos(dot(norm([own[0], 0, own[2]]), norm([-L.pos[0], 0, -L.pos[2]])));
    assert.ok(off <= (ASTEROID.aim * Math.PI) / 180 + 1e-9, `${k} aim`);
  }
  assert.ok(launched > 1800, `${launched} of 2000`);
});

test("over 30 minutes most rocks fall into the sun, and some hit a planet or moon", () => {
  // Only the clock and the rocks are stepped: nothing else in a bare world touches them.
  const w = bare();
  let burns = 0, landed = 0, other = 0;
  while (w.t < 1800) {
    tickClock(w, TICK);
    stepAsteroids(w, TICK);
    for (const ev of w.events) {
      if (ev.type === "burn") burns++;
      if (ev.type !== "explode") continue;
      const near = w.system.bodies.find((b) => surfaceInfo(b, w.poses[b.id], ev.pos).dist < ASTEROID.radius + 0.5);
      if (near && (near.kind === "planet" || near.kind === "moon")) landed++;
      else other++;
    }
    w.events.length = 0;
  }
  const launched = Array.from({ length: w.rocksLaunched }, (_, i) => launchOf(tuning, w.system, i + 1)).filter(Boolean).length;
  assert.ok(burns > launched / 2, `${burns} of ${launched} burn (${landed} land, ${other} other)`);
  assert.ok(landed >= 0.05 * launched, `${landed} of ${launched} land (${burns} burn)`);
});

test("a rock that lands on a planet explodes like a rocket: a player 2 m away is hurt and thrown", () => {
  const { w, b } = duel();
  const mid = w.poses.mid, side = [1, 0, 0];
  const r = rock(w, "rock.x", add(b.pos, add(scale(b.up, 6), scale(side, 2.6))), add(mid.vel, scale(b.up, -12)));
  for (let i = 0; i < 60 && !of(w, "explode").length; i++) stepWorld(w, {}, TICK);
  const ex = of(w, "explode")[0];
  assert.ok(ex, "exploded");
  assert.equal(ex.id, r.id);
  assert.equal(w.asteroids.length, 0);
  // It landed on the planet, not on the player.
  assert.ok(Math.abs(surfaceInfo(w.system.byId.mid, w.poses.mid, ex.pos).dist - ASTEROID.radius) < 0.05);
  const d = nearestSphere(ex.pos, b.pos, b.up).d;
  assert.ok(d > 2 && d < 3, `${d} m from the blast`);
  assert.ok(b.health < 100, `health ${b.health}`);
  assert.equal(b.groundId, null, "thrown off the ground");
  assert.ok(dot(sub(worldVel(w, b), w.poses.mid.vel), norm(sub(b.pos, ex.pos))) > 1, "pushed away from the blast");
  const hit = of(w, "hit").find((x) => x.id === "b");
  assert.equal(hit.by, null);
});

test("a pistol bullet sets a rock off, and its blast is the shooter's: a kill from it is theirs", () => {
  const { w, b } = duel();
  b.health = 5;
  const r = rock(w, "rock.x", add(b.pos, scale(b.up, 5)), [...w.poses.mid.vel]);
  const side = [1, 0, 0];
  w.projectiles.push({ id: "a.0.0", kind: "pistol", owner: "a", age: 1, lag: 0, pos: add(r.pos, scale(side, 3)), vel: add(scale(side, -120), w.poses.mid.vel) });
  stepWorld(w, {}, TICK);
  assert.equal(w.projectiles.length, 0, "the bullet stops at the rock");
  assert.deepEqual(of(w, "explode").map((x) => x.id), [r.id]);
  assert.equal(r.owner, "a");
  const death = of(w, "death")[0];
  assert.ok(death, "b died");
  assert.equal(death.by, "a");
  assert.equal(w.scores.a.kills, 1);
});

test("a rocket that meets a rock explodes there, and its blast sets the rock off as the shooter's", () => {
  const w = bare();
  const r = rock(w, "rock.x", SPACE);
  w.projectiles.push({ id: "a.0.0", kind: "rocket", owner: "a", age: 1, lag: 0, pos: add(SPACE, [3, 0, 0]), vel: [-120, 0, 0] });
  stepProjectiles(w, TICK);
  assert.deepEqual(of(w, "explode").map((x) => x.id), ["a.0.0", "rock.x"]);
  assert.ok(Math.abs(dist(of(w, "explode")[0].pos, SPACE) - ASTEROID.radius) < 1e-6, "the rocket stops at the rock");
  assert.equal(r.owner, "a");
  assert.equal(w.asteroids.length, 0);
});

test("a railgun ray sets off the first rock on its line", () => {
  const { w, a } = duel();
  Object.assign(a, createEntity("a", "player", SPACE, [0, 1, 0]), { forward: [1, 0, 0], weapons: ["pistol", "railgun"], ammo: { railgun: 5 }, weapon: "railgun" });
  const eye = add(a.pos, [0, tuning.PLAYER.eye, 0]);
  const near = rock(w, "rock.near", add(eye, [20, 0, 0])), far = rock(w, "rock.far", add(eye, [50, 0, 0]));
  assert.ok(fire(w, a));
  assert.deepEqual(of(w, "explode").map((x) => x.id), [near.id]);
  assert.deepEqual(w.asteroids, [far]);
  assert.ok(Math.abs(dist(w.beams[0].to, eye) - (20 - ASTEROID.radius)) < 1e-6, "the ray stops at the rock");
  assert.equal(near.owner, "a");
});

test("a rock that hits on its own leaves the credit to whoever hit you last", () => {
  for (const recent of [true, false]) {
    const { w, b } = duel();
    b.health = 5;
    if (recent) Object.assign(b, { lastHitBy: "a", lastHitAt: w.t });
    rock(w, "rock.x", add(b.pos, scale(b.up, 6)), add(w.poses.mid.vel, scale(b.up, -12)));
    for (let i = 0; i < 60 && !of(w, "death").length; i++) stepWorld(w, {}, TICK);
    const death = of(w, "death")[0];
    assert.ok(death, "b died");
    assert.equal(death.cause, "damage");
    assert.equal(death.by, recent ? "a" : null);
    assert.equal(w.scores.a.kills, recent ? 1 : 0);
    assert.equal(w.scores.b.deaths, 1);
  }
});

test("chain: a blast sets off a nearby rock, each rock explodes once, and the chain ends", () => {
  const w = bare();
  const reach = ASTEROID.blast.splash + ASTEROID.radius;
  const step = reach * 0.6; // each rock reaches the next and the one before, not the one after next
  const r1 = rock(w, "rock.1", SPACE), r2 = rock(w, "rock.2", add(SPACE, [step, 0, 0])), r3 = rock(w, "rock.3", add(SPACE, [2 * step, 0, 0]));
  const r4 = rock(w, "rock.4", add(SPACE, [2 * step + reach + 5, 0, 0]));
  detonate(w, r1, "a", 0);
  assert.deepEqual(of(w, "explode").map((x) => x.id), ["rock.1", "rock.2", "rock.3"]);
  assert.deepEqual(w.asteroids, [r4]);
  for (const r of [r1, r2, r3]) assert.equal(r.owner, "a");
  assert.equal(r4.owner, null);
});

test("a rock reaching the sun burns with no blast", () => {
  const w = bare();
  rock(w, "rock.x", add(w.poses.sun.pos, [0, 30, 0]), [0, -20, 0]);
  for (let i = 0; i < 60 && w.asteroids.length; i++) stepWorld(w, {}, TICK);
  assert.equal(w.asteroids.length, 0);
  assert.deepEqual(of(w, "burn").map(({ type, id }) => ({ type, id })), [{ type: "burn", id: "rock.x" }]);
  assert.equal(of(w, "explode").length, 0);
  assert.equal(w.explosions.length, 0);
});

test("the beam event carries its owner and the burn event its position", () => {
  // The beam half is in weapons.test.mjs. A burn sounds where the rock met the sun.
  const w = bare();
  rock(w, "rock.x", add(w.poses.sun.pos, [0, 30, 0]), [0, -20, 0]);
  for (let i = 0; i < 60 && w.asteroids.length; i++) stepWorld(w, {}, TICK);
  const [burn] = of(w, "burn");
  assert.ok(burn?.pos, JSON.stringify(burn));
  const sun = w.system.byId.sun;
  assert.ok(Math.abs(dist(burn.pos, w.poses.sun.pos) - (sun.radius + ASTEROID.radius)) < 1e-6, JSON.stringify(burn.pos));
});

test("a rock leaving the system is dropped", () => {
  const w = bare();
  rock(w, "rock.out", [0, tuning.VOID_RADIUS - 0.2, 0], [0, 30, 0]);
  const old = rock(w, "rock.old", SPACE);
  old.age = ASTEROID.life - TICK / 2;
  stepWorld(w, {}, TICK);
  assert.deepEqual(w.asteroids, []);
  assert.deepEqual(w.events, []);
});

test("a shot at a rock where the shooter saw it hits with lag", () => {
  const lag = 0.25, n = Math.round(lag / TICK);
  for (const [shotLag, hits] of [[lag, true], [0, false]]) {
    const w = bare();
    const r = rock(w, "rock.x", SPACE, [16, 0, 0]);
    const path = [];
    for (let i = 0; i < 2 * n; i++) {
      stepWorld(w, {}, TICK);
      path.push([...r.pos]);
    }
    const seen = path[path.length - 1 - n];
    assert.ok(dist(seen, r.pos) > ASTEROID.radius + 1, "the rock has moved on");
    w.projectiles.push({ id: "a.0.0", kind: "pistol", owner: "a", age: 1, lag: shotLag, pos: add(seen, [0, 0, 4]), vel: [0, 0, -240] });
    stepProjectiles(w, TICK);
    assert.equal(of(w, "explode").length, hits ? 1 : 0, `lag ${shotLag}`);
    assert.equal(w.asteroids.length, hits ? 0 : 1);
  }
});

test("a clock set forward launches only what falls due on the next tick, not a backlog", () => {
  const w = bare();
  w.t = 1000;
  w.poses = w.prevPoses = posesAt(w.system, w.t);
  stepWorld(w, {}, TICK);
  assert.equal(w.rocksLaunched, Math.floor(w.t / ASTEROID.every));
  assert.equal(w.asteroids.length, 0);
  w.t = 1050 - TICK / 2;
  stepWorld(w, {}, TICK);
  assert.deepEqual(w.asteroids.map((r) => r.id), launchOf(tuning, w.system, 70) ? ["rock.70"] : []);
});
