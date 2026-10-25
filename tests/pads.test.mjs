import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld } from "../src/sim/world.js";
import { padPos, predictLaunch } from "../src/sim/pads.js";
import { createEntity, standOn, NO_INPUT } from "../src/sim/entity.js";
import { surfaceInfo } from "../src/sim/collide.js";
import { add, scale } from "../src/sim/vec.js";
import { directions, skipTo } from "./helpers.mjs";

const { TICK, PADS, PAD_CUE } = tuning;
const planets = tuning.BODIES.filter((b) => b.kind === "planet").map((b) => b.id);

// Every pad's cue sampled every 0.5 s over the first 10 minutes (one full cycle of the planets' periods),
// computed once and shared by the window tests.
const STEP = 0.5, SPAN = 600;
const world = createWorld(tuning);
const timeline = Object.fromEntries(PADS.map((pad) => [pad.id, Array.from({ length: SPAN / STEP + 1 }, (_, i) => predictLaunch(world, pad, i * STEP).landsOn)]));

test("pads sit on their bodies' surfaces; two to three per planet, one on the station, none on the moon", () => {
  for (const pad of PADS) {
    const b = world.system.byId[pad.body];
    assert.ok(Math.abs(surfaceInfo(b, world.poses[b.id], padPos(world, pad, world.poses)).dist) < 1e-9, pad.id);
  }
  for (const id of planets) {
    const n = PADS.filter((p) => p.body === id).length;
    assert.ok(n >= 2 && n <= 3, `${id} has ${n}`);
  }
  assert.equal(PADS.filter((p) => world.system.byId[p.body].kind === "station").length, 1);
  assert.equal(PADS.filter((p) => world.system.byId[p.body].kind === "moon").length, 0);
});

test("every pad has at least one 5 s window in the first 10 minutes", () => {
  for (const pad of PADS) {
    let run = 0, best = 0;
    for (const landsOn of timeline[pad.id]) best = Math.max(best, (run = landsOn ? run + 1 : 0));
    assert.ok((best - 1) * STEP >= 5, `${pad.id}: longest window ${(best - 1) * STEP} s`);
  }
});

test("from every planet, some pad's cue is on at least once a minute", () => {
  for (const id of planets) {
    const pads = PADS.filter((p) => p.body === id);
    let last = 0, gap = 0;
    timeline[pads[0].id].forEach((_, i) => {
      if (pads.some((p) => timeline[p.id][i])) (gap = Math.max(gap, i * STEP - last)), (last = i * STEP);
    });
    gap = Math.max(gap, SPAN - last);
    assert.ok(gap <= 60, `${id}: longest gap ${gap} s`);
  }
});

test("launching while the cue is on lands on the predicted body", () => {
  for (const pad of PADS) {
    // The middle of the pad's longest window.
    const tl = timeline[pad.id];
    let run = 0, best = 0, end = 0;
    tl.forEach((x, i) => { run = x ? run + 1 : 0; if (run > best) (best = run), (end = i); });
    const mid = (end - Math.floor(best / 2)) * STEP;
    const w = createWorld(tuning);
    skipTo(w, mid);
    w.entities.dummy.alive = false; // out of the way
    w.entities.dummy.respawnAt = Infinity;
    const p = w.entities.player;
    const at = padPos(w, pad, w.poses), up = surfaceInfo(w.system.byId[pad.body], w.poses[pad.body], at).normal;
    Object.assign(p, createEntity("player", "player", at, up));
    standOn(p, pad.body);
    const want = predictLaunch(w, pad, w.t).landsOn;
    assert.ok(want, `${pad.id} cue on at ${w.t}`);
    let launched = false, landed = null;
    const bodyOfPad = (id) => PADS.find((x) => x.id === id).body;
    for (let i = 0; i < PAD_CUE.predict / TICK + 60 && !landed; i++) {
      w.events.length = 0;
      stepWorld(w, {}, TICK);
      // Landing on another body's pad relaunches in the same tick: that still counts as landing there.
      const relaunch = w.events.find((e) => e.type === "launch" && launched && bodyOfPad(e.padId) !== pad.body);
      launched ||= w.events.some((e) => e.type === "launch" && e.id === "player" && e.padId === pad.id);
      if (relaunch) landed = bodyOfPad(relaunch.padId);
      else if (launched && p.groundId && p.groundId !== pad.body) landed = p.groundId;
      assert.ok(p.alive, `${pad.id} died`);
    }
    assert.ok(launched, pad.id);
    assert.equal(landed, want, pad.id);
  }
});

test("a jump from the moon, anywhere on it, at any time, ends on the moon or its planet", () => {
  const moon = world.system.byId.moon;
  for (let k = 0; k < 6; k++) {
    for (const u of directions(8)) {
      const w = createWorld(tuning);
      skipTo(w, (k * moon.orbit.period) / 6);
      w.pads = [];
      w.entities.dummy.alive = false;
      w.entities.dummy.respawnAt = Infinity;
      const p = w.entities.player;
      Object.assign(p, createEntity("player", "player", add(w.poses.moon.pos, scale(u, moon.radius)), u));
      standOn(p, "moon");
      stepWorld(w, { player: { ...NO_INPUT, jump: true } }, TICK);
      let end = null;
      for (let i = 0; i < 60 / TICK && !end; i++) {
        stepWorld(w, {}, TICK);
        if (!p.alive) end = "dead";
        else if (p.groundId) end = p.groundId;
      }
      assert.ok(end === "moon" || end === moon.orbit.around, `k=${k} u=${u}: ${end}`);
    }
  }
});

test("cues refresh on their own, and the path starts at the pad", () => {
  const w = createWorld(tuning);
  for (let i = 0; i < PAD_CUE.refresh / TICK + PADS.length + 2; i++) stepWorld(w, {}, TICK);
  for (const pad of PADS) {
    const cue = w.cues[pad.id];
    assert.ok(cue && Array.isArray(cue.path) && cue.path.length > 1, pad.id);
    assert.ok(w.t - cue.at <= PAD_CUE.refresh + PADS.length * TICK + 1e-9, pad.id);
  }
});

test("a pad doesn't relaunch during its lockout", () => {
  const w = createWorld(tuning);
  const pad = PADS[0];
  const p = w.entities.player;
  const at = padPos(w, pad, w.poses);
  Object.assign(p, createEntity("player", "player", at, surfaceInfo(w.system.byId[pad.body], w.poses[pad.body], at).normal));
  standOn(p, pad.body);
  stepWorld(w, {}, TICK);
  assert.equal(w.events.filter((e) => e.type === "launch").length, 1);
  // Put it straight back on the pad: still locked out.
  Object.assign(p, { pos: padPos(w, pad, w.poses), groundId: pad.body, vel: [0, 0, 0] });
  stepWorld(w, {}, TICK);
  assert.equal(w.events.filter((e) => e.type === "launch").length, 1);
});
