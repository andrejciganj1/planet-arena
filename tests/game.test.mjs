import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld } from "../src/sim/world.js";
import { NO_INPUT, viewDir, unground } from "../src/sim/entity.js";
import { add, scale, cross, norm } from "../src/sim/vec.js";
import { launchOf } from "../src/sim/asteroids.js";
import { PROTOCOL } from "../src/net/protocol.js";
import { createGame } from "../server/game.js";
import { feedText } from "../src/client/hud.js";

const { NET } = tuning;
const hi = (g, conn, name, token, nonce) => g.hello(conn, { type: "hello", v: PROTOCOL, name, token, nonce });
const inp = (tick, extra = {}) => ({ type: "input", tick, view: tick - 6, input: { ...NO_INPUT, ...extra } });
const steps = (g, n) => { const out = []; for (let i = 0; i < n; i++) out.push(...g.step()); return out; };
const mk = () => { let n = 0; return createGame(tuning, { token: () => "tok" + ++n }); };

test("the first hello gets a welcome with an id, token, tick and t, and a fresh world", () => {
  const g = mk();
  assert.equal(g.world, null);
  const w = hi(g, "a", "Ann");
  assert.deepEqual(w, { type: "welcome", id: "p1", token: "tok1", tick: 0, t: 0, colour: tuning.COLOURS[1] });
  assert.equal(g.players(), 1);
  assert.equal(g.world.players.p1.name, "Ann");
});

test("a ninth player is told the game is full", () => {
  const g = mk();
  for (let i = 0; i < NET.maxPlayers; i++) assert.equal(hi(g, i, "x").type, "welcome");
  assert.deepEqual(hi(g, 99, "late"), { type: "full" });
  assert.equal(g.players(), NET.maxPlayers);
});

test("a wrong protocol version is told to reload", () => {
  const g = mk();
  assert.deepEqual(g.hello("a", { type: "hello", v: PROTOCOL + 1, name: "x" }), { type: "version" });
  assert.deepEqual(g.hello("a", { type: "hello", name: "x" }), { type: "version" });
  assert.equal(g.players(), 0);
});

test("same names get numbers, and each player gets a colour nobody else has", () => {
  const g = mk();
  for (let i = 0; i < NET.maxPlayers; i++) hi(g, i, "Sam");
  const ps = Object.values(g.world.players);
  assert.equal(new Set(ps.map((p) => p.name.toLowerCase())).size, NET.maxPlayers);
  assert.equal(ps[0].name, "Sam");
  assert.equal(ps[1].name, "Sam 2");
  assert.equal(new Set(ps.map((p) => p.colour)).size, NET.maxPlayers);
});

test("an input is applied at its tick; a late one's jump and turn are not lost", () => {
  // Late path: step T+1 runs with nothing, then input T+1 (jump, yaw) and T+2 (yaw) arrive.
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 30);
  const T = g.world.tick;
  steps(g, 1);
  g.input("a", inp(T + 1, { jump: true, yawDelta: 0.3 }));
  g.input("a", inp(T + 2, { yawDelta: 0.2 }));
  steps(g, 1);
  const e = g.world.entities.p1;
  assert.equal(e.groundId, null, "jumped");
  // Reference: the same two ticks of input as one input at T+2.
  const r = mk();
  hi(r, "a", "A"); hi(r, "b", "B");
  steps(r, 31);
  r.input("a", inp(T + 2, { jump: true, yawDelta: 0.5 }));
  steps(r, 1);
  const f = r.world.entities.p1;
  assert.equal(f.groundId, null);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(e.forward[i] - f.forward[i]) < 1e-9);
});

test("with no inputs a player keeps their held keys for NET.hold ticks, then lets go", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 10);
  const T = g.world.tick;
  Object.assign(g.world.entities.p1, { weapon: "minigun", weapons: ["pistol", "minigun"], ammo: { minigun: 300 } }); // fast cooldown
  g.input("a", inp(T + 1, { fire: true }));
  // Shots are counted on the entity: bullets may hit the ground at once.
  const shotsAt = [];
  let prev = g.world.entities.p1.shots;
  for (let i = 1; i <= NET.hold + 120; i++) {
    g.step();
    if (g.world.entities.p1.shots > prev) shotsAt.push(i);
    prev = g.world.entities.p1.shots;
  }
  assert.ok(shotsAt.length >= 2, "fired while held");
  assert.ok(shotsAt[shotsAt.length - 1] <= NET.hold + 1, `last shot at tick ${shotsAt[shotsAt.length - 1]}`);
});

test("dropped: the body leaves at once; back within 10 s with the token: same id, same score, no death", () => {
  const g = mk();
  hi(g, "a", "A"); const b = hi(g, "b", "B");
  steps(g, 5);
  g.world.scores.p2.kills = 3; g.world.scores.p2.deaths = 1;
  g.world.entities.p2.shots = 7;
  g.drop("b");
  assert.equal(g.world.entities.p2, undefined);
  assert.equal(g.world.players.p2, undefined);
  assert.equal(g.players(), 1);
  steps(g, 300);
  const w = hi(g, "b2", "ignored", b.token);
  assert.equal(w.id, "p2");
  assert.equal(w.token, b.token);
  assert.equal(w.colour, b.colour);
  assert.equal(g.world.players.p2.name, "B");
  assert.deepEqual(g.world.scores.p2, { kills: 3, deaths: 1 });
  assert.equal(g.world.entities.p2.shots, 7);
  assert.ok(g.world.entities.p2.alive);
});

test("after 10 s the token is forgotten: a new player at 0/0", () => {
  const g = mk();
  hi(g, "a", "A"); const b = hi(g, "b", "B");
  g.world.scores.p2.kills = 3;
  g.drop("b");
  steps(g, NET.rejoin * 60);
  assert.equal(g.world.scores.p2, undefined);
  const w = hi(g, "b2", "B", b.token);
  assert.equal(w.id, "p3");
  assert.notEqual(w.token, b.token);
  assert.deepEqual(g.world.scores.p3, { kills: 0, deaths: 0 });
});

test("the same token on two connections: the second gets a new player", () => {
  const g = mk();
  const a = hi(g, "a", "A", undefined, "n1");
  const w = hi(g, "a2", "A", a.token, "n2"); // a duplicated tab: same token, its own page nonce
  assert.equal(w.id, "p2");
  assert.notEqual(w.token, a.token);
  assert.equal(w.replaced, undefined);
  assert.equal(hi(g, "a4", "A", a.token).id, "p3", "no nonce never takes a body");
  assert.equal(g.players(), 3);
  g.drop("a");
  const back = hi(g, "a3", "A", a.token);
  assert.equal(back.id, "p1");
});

test("the same page on a new socket, before the old one is dropped, takes its body back", () => {
  const g = mk();
  const a = hi(g, "a", "A", undefined, "n1");
  for (let i = 1; i < NET.maxPlayers; i++) hi(g, "c" + i, "P"); // a full room still lets it back
  steps(g, 5);
  g.world.scores.p1.kills = 3; g.world.scores.p1.deaths = 1;
  const body = g.world.entities.p1;
  body.shots = 7;
  const w = hi(g, "a2", "A", a.token, "n1");
  assert.equal(w.type, "welcome");
  assert.equal(w.id, "p1");
  assert.equal(w.token, a.token);
  assert.equal(w.replaced, "a", "the server closes the old socket");
  assert.equal(g.players(), NET.maxPlayers);
  assert.equal(g.world.entities.p1, body, "one body, the same one");
  assert.equal(g.world.entities.p1.shots, 7);
  assert.deepEqual(g.world.scores.p1, { kills: 3, deaths: 1 });
  // The old socket's close, when it comes, changes nothing.
  g.drop("a");
  steps(g, 2);
  assert.equal(g.players(), NET.maxPlayers);
  assert.equal(g.world.entities.p1, body);
  assert.deepEqual(g.world.scores.p1, { kills: 3, deaths: 1 });
  // Inputs now come from the new socket.
  g.input("a2", inp(g.world.tick + 1, { jump: true }));
  g.input("a", inp(g.world.tick + 1, { yawDelta: 1 }));
  const fwd = [...body.forward];
  steps(g, 1);
  const turned = Math.acos(Math.min(1, fwd.reduce((d, x, i) => d + x * body.forward[i], 0)));
  assert.ok(turned < 0.1, `the old socket's turn is ignored (${turned} rad)`);
  assert.equal(body.groundId, null, "the new socket's jump is applied");
});

test("when the last player is gone and the reconnect window is over, the game resets", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 20);
  g.world.pickups.somewhere = { readyAt: g.world.t + 100 }; // a taken pickup
  g.world.scores.p1.kills = 2; g.world.scores.p2.deaths = 2;
  g.drop("a"); g.drop("b");
  steps(g, NET.rejoin * 60 - 1);
  assert.ok(g.world, "still waiting for a return");
  steps(g, 1);
  assert.equal(g.world, null);
  const w = hi(g, "c", "C");
  assert.equal(w.id, "p1");
  assert.equal(w.tick, 0);
  assert.equal(w.t, 0);
  assert.deepEqual(g.world.pickups, createWorld(tuning, { solo: false }).pickups); // none taken: all ready
  assert.deepEqual(g.world.scores, { p1: { kills: 0, deaths: 0 } });
});

test("snapshots every 2 ticks carry ack, slack and the events since the last one", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  g.input("a", inp(1));
  g.input("a", inp(9));
  g.world.events.push({ type: "marker" });
  const out = steps(g, 4);
  assert.deepEqual(out.map((o) => o.msg.tick), [2, 2, 4, 4]);
  const first = out.find((o) => o.conn === "a" && o.msg.tick === 2).msg;
  assert.equal(first.type, "snap");
  assert.equal(first.ack, 1);
  assert.equal(first.slack, 9 - 2);
  assert.ok(first.events.some((e) => e.type === "marker"));
  const second = out.find((o) => o.conn === "a" && o.msg.tick === 4).msg;
  assert.ok(!second.events.some((e) => e.type === "marker"));
  assert.equal(out.find((o) => o.conn === "b" && o.msg.tick === 2).msg.ack, 0);
});

test("garbage never crashes the room or puts NaN into the world", () => {
  const g = mk();
  hi(g, "a", "A");
  for (const x of [null, 1, "s", {}, { tick: "1" }, { tick: 1, input: { move: [NaN, NaN], yawDelta: 1e308 } }, { tick: 2, input: 5 }, { tick: 3, input: [1] }, { tick: 1e9 }, { tick: -4 }]) g.input("a", x);
  g.input("ghost", inp(1));
  assert.equal(hi(g, "c", { a: 1 }).type, "welcome");
  assert.equal(g.hello("d", null).type, "version");
  steps(g, 60);
  const bad = (v) => (typeof v === "number" ? !Number.isFinite(v) && Math.abs(v) !== Infinity : v && typeof v === "object" ? Object.values(v).some(bad) : false);
  for (const e of Object.values(g.world.entities)) assert.ok(!bad(e), e.id);
});

test("inputs too far ahead of the world, or too far behind what was applied, are dropped", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  g.input("a", inp(NET.maxAhead + 1));
  const out = steps(g, 2).filter((o) => o.conn === "a");
  assert.equal(out[0].msg.slack, 0 - 2, "a far-ahead input does not raise slack");
  const h = mk();
  hi(h, "a", "A"); hi(h, "b", "B");
  h.input("a", inp(NET.maxAhead));
  assert.equal(steps(h, 2).find((o) => o.conn === "a").msg.slack, NET.maxAhead - 2, "the edge is kept");

  // Behind: apply tick 100, then a weapon pick for tick 39 (too old) and tick 40 (just in).
  const k = mk();
  hi(k, "a", "A"); hi(k, "b", "B");
  const pick = (g2) => Object.assign(g2.world.entities.p1, { weapons: ["pistol", "shotgun"] });
  steps(k, 50);
  pick(k);
  k.input("a", inp(100));
  steps(k, 50);
  assert.equal(k.world.entities.p1.weapon, "pistol");
  k.input("a", inp(100 - NET.maxAhead - 1, { weapon: "shotgun" }));
  steps(k, 1);
  assert.equal(k.world.entities.p1.weapon, "pistol", "too old");
  k.input("a", inp(100 - NET.maxAhead, { weapon: "shotgun" }));
  steps(k, 1);
  assert.equal(k.world.entities.p1.weapon, "shotgun", "oldest allowed");
});

test("a late input's weapon pick is kept when the newest input has none", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 10);
  Object.assign(g.world.entities.p1, { weapons: ["pistol", "shotgun"] });
  const T = g.world.tick;
  steps(g, 1);
  g.input("a", inp(T + 1, { weapon: "shotgun" }));
  g.input("a", inp(T + 2));
  steps(g, 1);
  assert.equal(g.world.entities.p1.weapon, "shotgun");
});

test("lag is the view delay in seconds, clamped to NET.maxLag, in held ticks too", () => {
  const lagsFor = (view) => {
    const g = mk();
    hi(g, "a", "A"); hi(g, "b", "B");
    steps(g, 10);
    Object.assign(g.world.entities.p1, { weapon: "minigun", weapons: ["pistol", "minigun"], ammo: { minigun: 300 } });
    const T = g.world.tick;
    g.input("a", { tick: T + 1, view: view(T + 1), input: { ...NO_INPUT, fire: true } });
    const seen = new Map();
    for (let i = 0; i < NET.hold; i++) {
      g.step();
      for (const s of g.world.projectiles) if (s.owner === "p1") seen.set(s.id, s.lag);
    }
    return seen;
  };
  const six = lagsFor((t) => t - 6);
  assert.ok(six.size >= 2, "a first shot and held ones");
  for (const lag of six.values()) assert.ok(Math.abs(lag - 6 * tuning.TICK) < 1e-12, `${lag}`);
  // A view far behind is clamped.
  const far = (() => {
    const g = mk();
    hi(g, "a", "A"); hi(g, "b", "B");
    steps(g, 50);
    Object.assign(g.world.entities.p1, { weapon: "minigun", weapons: ["pistol", "minigun"], ammo: { minigun: 300 } });
    const T = g.world.tick;
    g.input("a", { tick: T + 1, view: 0, input: { ...NO_INPUT, fire: true } });
    const seen = new Map();
    for (let i = 0; i < NET.hold; i++) {
      g.step();
      for (const s of g.world.projectiles) if (s.owner === "p1") seen.set(s.id, s.lag);
    }
    return seen;
  })();
  assert.ok(far.size >= 2);
  for (const lag of far.values()) assert.equal(lag, NET.maxLag);
});

test("events do not pile up while nobody is connected", () => {
  const g = mk();
  hi(g, "a", "A");
  g.drop("a");
  g.world.events.push({ type: "marker" });
  steps(g, 3);
  assert.equal(g.world.events.length, 0);
});

test("a reconnect into a full room is told so, and the token still works once a seat is free", () => {
  const g = mk();
  const first = hi(g, "c0", "P");
  for (let i = 1; i < NET.maxPlayers; i++) hi(g, "c" + i, "P");
  g.world.scores.p1.kills = 4;
  g.drop("c0");
  hi(g, "extra", "Q"); // takes the seat
  assert.equal(g.players(), NET.maxPlayers);
  assert.deepEqual(hi(g, "c0b", "P", first.token), { type: "full" });
  g.drop("c1");
  const w = hi(g, "c0b", "P", first.token);
  assert.equal(w.id, "p1");
  assert.deepEqual(g.world.scores.p1, { kills: 4, deaths: 0 });
});

test("slack follows the newest input received, also when a client's ticks go back", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 2);
  g.input("a", inp(20));
  assert.equal(steps(g, 2).find((o) => o.conn === "a").msg.slack, 20 - 4);
  g.input("a", inp(6)); // the client restarted its clock lower
  assert.equal(steps(g, 2).find((o) => o.conn === "a").msg.slack, 6 - 6);
});

test("a kill by a player who has just dropped still shows their name", () => {
  const g = mk();
  hi(g, "a", "Ana"); hi(g, "b", "Ben");
  steps(g, 10);
  const victim = g.world.entities.p1;
  Object.assign(victim, { lastHitBy: "p2", lastHitAt: g.world.t });
  g.drop("b");
  victim.pos = [...g.world.poses.sun.pos]; // into the sun
  const snaps = steps(g, 4).filter((o) => o.conn === "a").map((o) => o.msg);
  const snap = snaps.find((m) => m.events.some((e) => e.type === "death"));
  const death = snap.events.find((e) => e.type === "death");
  assert.equal(death.by, "p2");
  assert.equal(feedText(death, snap.players), "Ben ☀ Ana");
  assert.equal(snap.players.p2.away, true);
  assert.equal(snap.players.p1.away, undefined);
  steps(g, NET.rejoin * 60);
  assert.equal(steps(g, 2).find((o) => o.conn === "a").msg.players.p2, undefined, "gone once the window is over");
});

test("two players: a rock set off by one player's shot kills the other; scores agree", () => {
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 10);
  const w = g.world, a = w.entities.p1, b = w.entities.p2;
  Object.assign(a, { weapon: "railgun", weapons: ["pistol", "railgun"], ammo: { railgun: 5 } });
  // A rock 20 m along a's view; b floats beside it, inside its blast but off the railgun's line.
  const dir = viewDir(a), at = add(add(a.pos, scale(a.up, tuning.PLAYER.eye)), scale(dir, 20));
  w.asteroids.push({ id: "rock.99", pos: at, vel: [0, 0, 0], age: 0, owner: null });
  unground(w, b);
  Object.assign(b, { pos: add(at, scale(norm(cross(dir, a.up)), 3.5)), vel: [0, 0, 0], health: 10 });
  const before = steps(g, 2).map((o) => o.msg);
  for (const m of before) assert.ok(m.rocks.some((x) => x.id === "rock.99" && x.owner === null), "both see the rock");
  const T = g.world.tick;
  g.input("a", { type: "input", tick: T + 1, view: T + 1, input: { ...NO_INPUT, fire: true } });
  const after = steps(g, 2);
  const events = after[0].msg.events;
  assert.ok(events.some((e) => e.type === "explode" && e.id === "rock.99"), "a's shot set it off");
  assert.ok(events.some((e) => e.type === "death" && e.id === "p2" && e.by === "p1" && e.cause === "damage"), "b died, a's kill");
  assert.ok(!g.world.asteroids.some((x) => x.id === "rock.99"));
  const seen = Object.fromEntries(after.map((o) => [o.conn, o.msg]));
  for (const conn of ["a", "b"]) {
    assert.ok(!seen[conn].rocks.some((x) => x.id === "rock.99"), `${conn}: the rock is gone`);
    assert.deepEqual(seen[conn].players.p1, { name: "A", colour: g.world.players.p1.colour, kills: 1, deaths: 0 });
    assert.deepEqual(seen[conn].players.p2, { name: "B", colour: g.world.players.p2.colour, kills: 0, deaths: 1 });
  }
  assert.deepEqual(seen.a.players, seen.b.players);
});

test("after everyone leaves, the new game starts with no rocks and launches from k = 1 again", () => {
  const { ASTEROID } = tuning;
  const g = mk();
  hi(g, "a", "A"); hi(g, "b", "B");
  steps(g, 35 * 60); // rock.2 is in flight from 30 s
  assert.ok(g.world.asteroids.length > 0, "rocks flying when everyone leaves");
  assert.ok(g.world.rocksLaunched >= 2);
  g.drop("a"); g.drop("b");
  steps(g, NET.rejoin * 60);
  assert.equal(g.world, null);
  hi(g, "c", "C");
  assert.deepEqual(g.world.asteroids, []);
  assert.equal(g.world.rocksLaunched, 0);
  const early = steps(g, ASTEROID.every * 60 - 2).map((o) => o.msg);
  assert.ok(early.length > 0 && early.every((m) => m.rocks.length === 0), "none before the first launch time");
  assert.ok(launchOf(tuning, g.world.system, 1));
  const due = steps(g, 4).map((o) => o.msg);
  assert.equal(g.world.rocksLaunched, 1);
  assert.deepEqual(due.at(-1).rocks.map((x) => x.id), ["rock.1"]);
});
