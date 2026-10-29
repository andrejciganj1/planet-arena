import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { NO_INPUT, viewDir, worldVel } from "../src/sim/entity.js";
import { add, scale, dist } from "../src/sim/vec.js";
import { launchOf } from "../src/sim/asteroids.js";
import { createWorld } from "../src/sim/world.js";
import { explode, detonate, stepProjectiles } from "../src/sim/weapons.js";
import { createGame } from "../server/game.js";
import { createOnlineGame, clockNudge } from "../src/client/online.js";

const { TICK, NET } = tuning;
const json = (x) => JSON.parse(JSON.stringify(x));

test("clockNudge speeds up when inputs arrive late, slows down when far ahead", () => {
  assert.equal(clockNudge(NET.slack[0] - 1), 1);
  assert.equal(clockNudge(NET.slack[1] + 1), -1);
  for (let s = NET.slack[0]; s <= NET.slack[1]; s++) assert.equal(clockNudge(s), 0);
});

// A game room and an in-memory stand-in for net.js: it opens at once, says hello as net.js does, and
// carries messages both ways as JSON would.
function room() {
  const game = createGame(tuning);
  const inbox = new Map(); // conn -> onMessage
  const connect = (url, { hello, onMessage, onStatus }) => {
    const conn = {};
    inbox.set(conn, onMessage);
    onStatus("open");
    onMessage(json(game.hello(conn, json(hello()))));
    return { send: (msg) => msg.type === "input" && game.input(conn, json(msg)), close() {} };
  };
  const sent = [];
  const step = () => {
    for (const { conn, msg } of game.step()) {
      sent.push(msg);
      inbox.get(conn)(json(msg));
    }
  };
  // Hands a message to every browser, as if the server had sent it.
  const deliver = (msg) => {
    for (const onMessage of inbox.values()) onMessage(json(msg));
  };
  return { game, connect, step, sent, deliver };
}

// Browsers joined to the room; each frame is 1/60 s of real time and the room steps once per frame.
function play(r) {
  const browsers = [];
  const join = (name, script) => {
    const b = { g: createOnlineGame(tuning, "memory", name, r.connect), script, n: 0, predicted: new Map() };
    browsers.push(b);
    return b;
  };
  const frame = (each = () => {}) => {
    for (const b of browsers) {
      b.g.frame(TICK, () => b.script(b.n++));
      if (b.g.me) b.predicted.set(b.g.world.tick, [...b.g.me.pos]);
    }
    r.step();
    each();
  };
  return { browsers, join, frame };
}

test("a browser and the room, joined in memory, agree and see each other", () => {
  const r = room();
  const { browsers, join, frame } = play(r);
  join("Ana", (i) => ({ ...NO_INPUT, move: [0, 1], yawDelta: 0.01, jump: i % 90 === 30 }));
  let checked = 0;
  for (let f = 0; f < 300; f++) {
    if (f === 20) join("Ben", (i) => ({ ...NO_INPUT, move: [1, 0.5], yawDelta: -0.02, jump: i % 70 === 10 }));
    frame(() => {
      for (const b of browsers) {
        const mine = b.predicted.get(r.game.world.tick);
        if (!mine) continue;
        const theirs = r.game.world.entities[b.g.id].pos;
        assert.ok(dist(mine, theirs) < 1e-6, `${b.g.id} at tick ${r.game.world.tick}: ${mine} vs ${theirs}`);
        checked++;
      }
    });
  }
  assert.ok(checked > 400, `compared ${checked} ticks`);
  // The views start NET.lead ticks ahead and are nudged until their inputs arrive within NET.slack.
  for (const m of r.sent.slice(-4)) assert.ok(m.slack >= NET.slack[0] && m.slack <= NET.slack[1], `slack ${m.slack}`);
  const ids = browsers.map((b) => b.g.id).sort();
  assert.equal(new Set(ids).size, 2);
  for (const b of browsers) {
    assert.deepEqual(Object.keys(b.g.world.players).sort(), ids);
    for (const id of ids) assert.ok(b.g.world.entities[id]?.alive, `${b.g.id} sees ${id}`);
    assert.equal(b.g.world.entities.dummy, undefined, "two players: no dummy");
    assert.equal(b.g.world.selfId, b.g.id);
  }
});

test("your own rocket's blast is drawn once, not again when the server's arrives", () => {
  const r = room();
  const { join, frame } = play(r);
  let fire = Infinity;
  const a = join("Ana", (i) => ({ ...NO_INPUT, pitchDelta: i === 5 ? -2 : 0, weapon: i === 5 ? "rocket" : null, fire: i === fire }));
  frame();
  Object.assign(r.game.world.entities[a.g.id], { weapons: ["pistol", "rocket"], ammo: { rocket: 5 } });
  for (let f = 0; f < 10; f++) frame();
  assert.equal(a.g.me.weapon, "rocket");
  fire = a.n;
  let most = 0, events = 0;
  for (let f = 0; f < 60; f++) {
    frame();
    most = Math.max(most, a.g.world.explosions.length);
    events += a.g.world.events.filter((e) => e.type === "explode").length;
    a.g.world.events.length = 0; // as main.js does each frame
  }
  assert.equal(r.sent.flatMap((m) => m.events).filter((e) => e.type === "explode").length, 1, "the room's rocket went off");
  assert.equal(events, 1, "one blast event in the view");
  assert.equal(most, 1, "one blast on screen");
});

test("a hidden tab's snapshots leave only the blasts and beams still showing", () => {
  const r = room();
  const { join, frame } = play(r);
  const a = join("Ana", () => NO_INPUT);
  for (let f = 0; f < 10; f++) frame();
  // 3000 snapshots (100 s) arrive with no frame drawn, each with someone's blast and beam.
  const last = r.sent.at(-1);
  let tick = last.tick, t = last.t;
  for (let k = 0; k < 3000; k++) {
    for (let i = 0; i < tuning.NET.snapEvery; i++) (tick++, (t += TICK));
    const beam = { id: `x.${k}.0`, from: [0, 300, 0], to: [10, 300, 0], age: 0, owner: "x" };
    r.deliver({ ...last, tick, t, slack: 3, beams: [beam], events: [{ type: "explode", pos: [0, 300, 0], id: `x.${k}.1` }] });
  }
  // At most what shows at once: one of each per snapshot for as long as they show.
  const most = (showFor) => Math.ceil(showFor / (tuning.NET.snapEvery * TICK)) + 1;
  const { ROCKET, WEAPONS } = tuning;
  const w = a.g.world;
  assert.ok(w.explosions.length <= most(ROCKET.showFor), `${w.explosions.length} blasts while hidden`);
  assert.ok(w.beams.length <= most(WEAPONS.railgun.showFor), `${w.beams.length} beams while hidden`);
  a.g.frame(TICK, () => NO_INPUT);
  assert.ok(w.explosions.length > 0 && w.explosions.length <= most(ROCKET.showFor), `${w.explosions.length} blasts after`);
  assert.ok(w.beams.length > 0 && w.beams.length <= most(WEAPONS.railgun.showFor), `${w.beams.length} beams after`);
  assert.ok(w.explosions.every((x) => x.age < ROCKET.showFor) && w.beams.every((b) => b.age < WEAPONS.railgun.showFor));
  // The newest are the ones left, aged by the snapshot clock.
  assert.ok(w.beams.some((b) => b.id === "x.2999.0"));
});

test("after the clock restarts lower (snapshots stopped a while), the next late snapshot nudges again", () => {
  const r = room();
  const { join, frame } = play(r);
  const a = join("Ana", () => NO_INPUT);
  for (let f = 0; f < 30; f++) frame();
  const last = r.sent.at(-1);
  const w = a.g.world;
  const at = (k) => ({ ...last, tick: last.tick + k, t: last.t + k * TICK, events: [], beams: [] });
  r.deliver({ ...at(2), slack: -10 }); // inputs late: one extra tick, and wait for the server to see it
  a.g.frame(TICK, () => NO_INPUT);
  // Snapshots stop while frames run on, until the view is more than NET.resync ticks ahead.
  for (let f = 0; f < NET.resync + 10; f++) a.g.frame(TICK, () => NO_INPUT);
  r.deliver({ ...at(4), slack: -10 }); // the clock restarts at this tick + NET.lead; inputs still late
  assert.equal(w.tick, last.tick + 4 + NET.lead, "restarted lower");
  const before = w.tick;
  a.g.frame(TICK, () => NO_INPUT);
  assert.equal(w.tick - before, 2, "one tick and the nudge");
});

test("a page says hello with one nonce on every open; another page has its own", () => {
  const hellos = [];
  const connect = (url, { hello }) => {
    hellos.push(hello(), hello()); // net.js says hello again on every reopen
    return { send() {}, close() {} };
  };
  createOnlineGame(tuning, "memory", "Ana", connect);
  createOnlineGame(tuning, "memory", "Ana", connect);
  const [a, a2, b] = hellos.map((h) => h.nonce);
  assert.equal(typeof a, "string");
  assert.ok(a.length >= 8);
  assert.equal(a2, a);
  assert.notEqual(b, a);
});

test("rocks from snapshots are in the view; the view never launches its own", () => {
  const r = room();
  const { join, frame } = play(r);
  const a = join("Ana", () => NO_INPUT);
  const w = a.g.world;
  for (let f = 0; f < 10; f++) frame();
  const rock = { id: "rock.99", pos: [0, 80, 0], vel: [3, 0, 0], age: 0, owner: null };
  r.game.world.asteroids.push(rock);
  for (let f = 0; f < 20; f++) frame();
  const seen = w.asteroids.find((x) => x.id === "rock.99");
  assert.ok(seen, "the room's rock is drawn");
  assert.ok(dist(seen.pos, rock.pos) < 1, `drawn a little in the past: ${seen.pos} vs ${rock.pos}`);
  // 30 s of snapshots with no rocks, past the first two launch times: the view draws none.
  assert.ok(launchOf(tuning, w.system, 1) && launchOf(tuning, w.system, 2), "launches due in this time");
  const last = r.sent.at(-1);
  let tick = last.tick, t = last.t;
  for (let f = 0; f < 30 / TICK; f++) {
    if (f % NET.snapEvery === 0) {
      for (let i = 0; i < NET.snapEvery; i++) (tick++, (t += TICK));
      r.deliver({ ...last, tick, t, slack: 3, events: [], beams: [], rocks: [] });
    }
    a.g.frame(TICK, () => NO_INPUT);
    if (f >= 30) assert.equal(w.asteroids.length, 0, `frame ${f}`);
  }
  assert.ok(w.t > 2 * tuning.ASTEROID.every);
  assert.equal(w.rocksLaunched, 0);
});

test("your bullet stops at a rock on your screen and the rock waits for the server", () => {
  const r = room();
  const { join, frame } = play(r);
  let fireAt = Infinity;
  const a = join("Ana", (i) => ({ ...NO_INPUT, pitchDelta: i === 5 ? 0.4 : 0, fire: i === fireAt }));
  const w = a.g.world;
  for (let f = 0; f < 20; f++) frame();
  // A rock 12 m along your view, keeping pace with the ground you stand on.
  const sw = r.game.world, me = sw.entities[a.g.id];
  const eye = add(me.pos, scale(me.up, tuning.PLAYER.eye));
  const rock = { id: "rock.99", pos: add(eye, scale(viewDir(me), 12)), vel: worldVel(sw, me), age: 0, owner: null };
  sw.asteroids.push(rock);
  for (let f = 0; f < 30 && !w.asteroids.some((x) => x.id === rock.id); f++) frame();
  assert.ok(w.asteroids.some((x) => x.id === rock.id), "the rock is on your screen");
  fireAt = a.n;
  const blastSent = () => r.sent.some((m) => m.events.some((e) => e.type === "explode" && e.id === rock.id));
  let flew = false, stopped = null, known = null, drawn = 0;
  for (let f = 0; f < 90; f++) {
    const heard = blastSent(); // delivered before this frame, which may draw it
    const before = w.asteroids.find((x) => x.id === rock.id);
    frame();
    const mine = w.projectiles.filter((p) => p.owner === a.g.id);
    if (mine.length) {
      flew = true;
      // Never into or through the rock as drawn (the ticks of a frame meet the rocks drawn before it).
      if (before) for (const p of mine) assert.ok(dist(p.pos, before.pos) >= tuning.ASTEROID.radius - 1e-6, `frame ${f}: inside the rock`);
    } else if (flew && stopped === null) {
      stopped = f;
      assert.ok(before && w.asteroids.some((x) => x.id === rock.id), "the rock is still drawn when your bullet stops");
    }
    // The server's event is in the view as its snapshot arrives; its blast is drawn from the next frame.
    if (!heard) assert.equal(w.explosions.length, 0, `frame ${f}: no blast before the server's`);
    if (!blastSent()) assert.equal(w.events.filter((e) => e.type === "explode").length, 0, `frame ${f}: no blast event before the server's`);
    else known ??= f;
    drawn = Math.max(drawn, w.explosions.length);
  }
  assert.ok(flew && stopped !== null, "your bullet flew and stopped");
  assert.ok(known !== null && stopped < known, `stopped at frame ${stopped}, before the server's blast (${known})`);
  assert.equal(drawn, 1, "the server's blast is drawn");
  assert.equal(w.events.filter((e) => e.type === "explode" && e.id === rock.id).length, 1);
  assert.ok(!sw.asteroids.includes(rock) && rock.owner === a.g.id, "the room set it off, with your shot");
  assert.ok(!w.asteroids.some((x) => x.id === rock.id), "and the view lets it go");
});

test("a cosmetic world never sets a rock off: your rocket's blast beside one leaves it for the server", () => {
  const w = { ...createWorld(tuning, { solo: false }), cosmetic: true, selfId: "me" };
  const rock = { id: "rock.5", pos: [0, 80, 0], vel: [0, 0, 0], age: 0, owner: null };
  w.asteroids.push(rock);
  detonate(w, rock, "me");
  explode(w, [2, 80, 0], "me", 0, "me.1.0");
  // A rocket flown into it bursts there (your own blast, as the server's will be) and the rock stays.
  w.projectiles.push({ id: "me.2.0", kind: "rocket", owner: "me", age: 1, pos: [0, 80, 10], vel: [0, 0, -600], lag: 0, from: [0, 80, 10] });
  stepProjectiles(w, TICK);
  assert.deepEqual(w.asteroids, [rock]);
  assert.equal(rock.owner, null);
  assert.deepEqual(w.events.map((e) => e.id), ["me.1.0", "me.2.0"], "only your rockets' blasts");
  assert.equal(w.projectiles.length, 0);
});

test("a rock stops being drawn once its blast or burn is heard, even if an older snapshot still lists it", () => {
  for (const type of ["explode", "burn"]) {
    const r = room();
    const { join, frame } = play(r);
    const a = join("Ana", () => NO_INPUT);
    const w = a.g.world;
    for (let f = 0; f < 10; f++) frame();
    r.game.world.asteroids.push({ id: "rock.99", pos: [0, 80, 0], vel: [3, 0, 0], age: 0, owner: null });
    for (let f = 0; f < 20 && !w.asteroids.some((x) => x.id === "rock.99"); f++) frame();
    assert.ok(w.asteroids.some((x) => x.id === "rock.99"), `${type}: the rock is drawn`);
    // The event arrives in a snapshot that still lists the rock, as the server's blast does.
    const last = r.sent.at(-1);
    assert.ok(last.rocks.some((k) => k.id === "rock.99"), "the snapshot lists the rock");
    r.deliver({ ...last, tick: last.tick + 1, t: last.t + TICK, events: [{ type, id: "rock.99", pos: [0, 80, 0] }] });
    a.g.frame(TICK, () => NO_INPUT);
    assert.ok(!w.asteroids.some((x) => x.id === "rock.99"), `${type}: no longer drawn`);
  }
});
