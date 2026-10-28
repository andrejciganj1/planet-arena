import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { NO_INPUT } from "../src/sim/entity.js";
import { dist } from "../src/sim/vec.js";
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
  return { game, connect, step, sent };
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
