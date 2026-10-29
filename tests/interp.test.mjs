import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { placeRec } from "../src/sim/lag.js";
import { createInterp } from "../src/net/interp.js";
import { add, sub, scale, dist, len } from "../src/sim/vec.js";

const { TICK, NET } = tuning;
const system = createSystem(tuning.BODIES);
const close = (a, b, eps = 1e-9) => assert.ok(dist(a, b) < eps, `${a} vs ${b}`);

const rec = (id, o) => ({ id, pos: [0, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], groundId: null, alive: true, ...o });
const snap = (tick, entities, shots = [], rocks = []) => ({ type: "snap", tick, t: tick * TICK, entities, shots, rocks });

test("halfway between two snapshots, a floating player is halfway", () => {
  const ip = createInterp(system);
  ip.push(snap(10, [rec("a", { pos: [0, 100, 0], forward: [1, 0, 0] })]));
  ip.push(snap(12, [rec("a", { pos: [10, 100, 0], forward: [0, 0, 1] })]));
  assert.equal(ip.newest(), 12);
  const a = ip.sample(11).entities.a;
  close(a.pos, [5, 100, 0]);
  assert.ok(Math.abs(len(a.forward) - 1) < 1e-9);
  close(a.forward, [Math.SQRT1_2, 0, Math.SQRT1_2]);
});

test("a player standing on a moving planet stays on its surface when drawn on the browser's later poses", () => {
  const mid = system.byId.mid;
  const ip = createInterp(system);
  const on = (tick, up) => {
    const t = tick * TICK;
    const p = posesAt(system, t).mid.pos;
    return rec("a", { groundId: "mid", up, pos: add(p, scale(up, mid.radius)) });
  };
  ip.push(snap(100, [on(100, [0, 1, 0])]));
  ip.push(snap(102, [on(102, [1, 0, 0])]));
  const r = ip.sample(101).entities.a;
  assert.ok(r.rel);
  const t = 101 * TICK + 0.15;
  const feet = placeRec(r, posesAt(system, t));
  assert.ok(Math.abs(dist(feet, posesAt(system, t).mid.pos) - mid.radius) < 1e-6);
});

test("on a ground or air switch, the later record wins", () => {
  const ip = createInterp(system);
  const p = posesAt(system, 100 * TICK).mid.pos;
  ip.push(snap(100, [rec("a", { pos: [0, 100, 0] })]));
  ip.push(snap(102, [rec("a", { groundId: "mid", pos: add(p, [0, 12, 0]) })]));
  const r = ip.sample(101).entities.a;
  assert.equal(r.groundId, "mid");
  close(r.pos, add(p, [0, 12, 0]));
  ip.push(snap(104, [rec("a", { pos: [3, 4, 5] })]));
  const s = ip.sample(103).entities.a;
  assert.equal(s.groundId, null);
  close(s.pos, [3, 4, 5]);
});

test("a player missing from the later snapshot is gone", () => {
  const ip = createInterp(system);
  ip.push(snap(10, [rec("a", {}), rec("b", {})]));
  ip.push(snap(12, [rec("a", {})]));
  const e = ip.sample(11).entities;
  assert.ok(e.a);
  assert.equal(e.b, undefined);
  assert.ok(ip.sample(10).entities.b, "at the earlier snapshot itself b still exists");
});

test("shots are interpolated by id", () => {
  const ip = createInterp(system);
  ip.push(snap(10, [], [{ id: 1, kind: "rocket", owner: "a", pos: [0, 0, 0], vel: [1, 0, 0] }]));
  ip.push(snap(12, [], [
    { id: 1, kind: "rocket", owner: "a", pos: [4, 0, 0], vel: [1, 0, 0] },
    { id: 2, kind: "rocket", owner: "a", pos: [9, 9, 9], vel: [0, 0, 0] },
  ]));
  const s = ip.sample(11).shots;
  assert.equal(s.length, 2);
  close(s.find((x) => x.id === 1).pos, [2, 0, 0]);
  close(s.find((x) => x.id === 2).pos, [9, 9, 9]);
  assert.equal(ip.sample(11.5).shots.find((x) => x.id === 1).pos[0], 3);
});

test("rocks are drawn between snapshots like shots", () => {
  const ip = createInterp(system);
  assert.deepEqual(ip.sample(5).rocks, [], "nothing arrived yet");
  ip.push(snap(10, [], [], [{ id: "rock.1", pos: [0, 0, 0], vel: [2, 0, 0], owner: null }]));
  ip.push(snap(12, [], [], [
    { id: "rock.1", pos: [4, 0, 0], vel: [2, 0, 0], owner: null },
    { id: "rock.2", pos: [150, 1, 0], vel: [0, 0, 9], owner: null },
  ]));
  const r = ip.sample(11).rocks;
  assert.equal(r.length, 2);
  close(r.find((x) => x.id === "rock.1").pos, [2, 0, 0]);
  close(r.find((x) => x.id === "rock.2").pos, [150, 1, 0]); // new in the later snapshot: drawn where it is
  assert.equal(ip.sample(11.5).rocks.find((x) => x.id === "rock.1").pos[0], 3);
  // One gone from the later snapshot (set off, burnt, dropped) is not drawn.
  ip.push(snap(14, [], [], [{ id: "rock.2", pos: [150, 1, 4], vel: [0, 0, 9], owner: null }]));
  assert.deepEqual(ip.sample(13).rocks.map((x) => x.id), ["rock.2"]);
  close(ip.sample(13).rocks[0].pos, [150, 1, 2]);
});

test("before the oldest and after the newest, the end snapshots", () => {
  const ip = createInterp(system);
  ip.push(snap(10, [rec("a", { pos: [1, 0, 0] })]));
  ip.push(snap(12, [rec("a", { pos: [2, 0, 0] })]));
  close(ip.sample(5).entities.a.pos, [1, 0, 0]);
  close(ip.sample(20).entities.a.pos, [2, 0, 0]);
});

test("the view tick trails the newest snapshot by NET.interp, advances with time and is nudged back", () => {
  const ip = createInterp(system);
  ip.push(snap(100, [rec("a", {})]));
  assert.equal(ip.view(), 100 - NET.interp);
  ip.push(snap(102, [rec("a", {})]));
  const v = ip.advance(TICK);
  assert.ok(v > 100 - NET.interp && v <= 102 - NET.interp + 1e-9);
  // With no more snapshots the view never runs past the newest one.
  for (let i = 0; i < 600; i++) ip.advance(TICK);
  assert.ok(ip.view() <= 102);
  // A big jump (a stall) is caught up with by nudging while snapshots keep arriving every 2 ticks.
  let tick = 102;
  for (let i = 0; i < 600; i++) {
    if (i % 2 === 0) ip.push(snap((tick += 2), [rec("a", {})]));
    ip.advance(TICK);
  }
  assert.ok(Math.abs(ip.view() - (tick - NET.interp)) < 1.5);
});

test("between a corpse and its respawn, the later record wins (no slide across the map)", () => {
  const ip = createInterp(system);
  ip.push(snap(10, [rec("a", { alive: false, pos: [0, 100, 0] })]));
  ip.push(snap(12, [rec("a", { alive: true, pos: [50, 100, 0] })]));
  const r = ip.sample(11).entities.a;
  assert.equal(r.alive, true);
  close(r.pos, [50, 100, 0]);
});
