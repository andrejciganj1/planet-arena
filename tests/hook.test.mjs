import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld } from "../src/sim/world.js";
import { hookAnchor } from "../src/sim/hook.js";
import { hookable } from "../src/client/hud.js";
import { explode } from "../src/sim/weapons.js";
import { createEntity, standOn, hitCentre, NO_INPUT } from "../src/sim/entity.js";
import { add, sub, scale, norm, dist, len, dot, cross, anyPerpendicular } from "../src/sim/vec.js";
import { skipTo } from "./helpers.mjs";

const { TICK, HOOK, PLAYER } = tuning;
const HOLD = { player: { ...NO_INPUT, hook: true } };

// A pad-free world at t with the dummy out of the way.
function world(t = 0) {
  const w = { ...createWorld(tuning), pads: [] };
  skipTo(w, t);
  w.entities.dummy.alive = false;
  w.entities.dummy.respawnAt = Infinity;
  return w;
}
// The player floating with its eye at `eye`, looking along `dir`, moving at world velocity `vel`.
function float(w, eye, dir, vel = [0, 0, 0]) {
  const up = norm(anyPerpendicular(dir)), p = w.entities.player;
  Object.assign(p, createEntity("player", "player", sub(eye, scale(up, PLAYER.eye)), up), { forward: dir, vel });
  return p;
}
// The player floating `gap` m above body id, up away from it, looking down at it (pitch, so the aim holds
// while up settles), moving with the body.
function above(w, id, gap) {
  const b = w.system.byId[id], c = w.poses[id].pos, p = w.entities.player;
  Object.assign(p, createEntity("player", "player", add(c, [0, b.radius + gap - PLAYER.eye, 0]), [0, 1, 0]), { vel: [...w.poses[id].vel], pitch: (-89 * Math.PI) / 180 });
  return p;
}
const NaNfree = (e) => ![...e.pos, ...e.vel, ...e.up].some(Number.isNaN);
// Holds the hook until it catches or its flight ends (a miss); returns the ticks that took.
function hold(w, p, max = 1 / TICK) {
  let n = 0;
  do {
    stepWorld(w, HOLD, TICK);
    n++;
  } while (!p.hook && p.hookShot && n < max);
  return n;
}

test("the hook catches a body within 25 m and misses beyond; never the sun, never your own ground", () => {
  for (const [gap, caught] of [[20, true], [30, false]]) {
    const w = world(), g = w.poses.giant.pos, r = w.system.byId.giant.radius;
    const p = float(w, add(g, [0, r + gap, 0]), [0, -1, 0]);
    hold(w, p);
    assert.equal(!!p.hook, caught, `${gap} m`);
    if (caught) assert.equal(p.hook.body, "giant");
    else assert.ok(p.hookCooldown > 0, "a miss starts the wait");
  }
  const w = world(), sun = w.system.byId.sun;
  const p = float(w, [0, sun.radius + 15, 0], [0, -1, 0]);
  hold(w, p);
  assert.equal(p.hook, null, "not the sun");
  const w2 = world(), q = w2.entities.player;
  q.pitch = -1.5; // standing on the mid planet, looking at your feet
  hold(w2, q);
  assert.equal(q.hook, null, "not your own ground");
  assert.equal(q.hookShot, null);
});

test("from the heavy planet, hooking the moon and holding lands you on the moon", () => {
  for (const t of [0, 30, 65]) {
    const w = world(t), heavy = w.system.byId.heavy;
    const u = norm(sub(w.poses.moon.pos, w.poses.heavy.pos));
    const p = w.entities.player;
    Object.assign(p, createEntity("player", "player", add(w.poses.heavy.pos, scale(u, heavy.radius)), u));
    standOn(p, "heavy");
    p.pitch = (89 * Math.PI) / 180; // straight up at the moon
    let end = null;
    for (let i = 0; i < 5 / TICK && !end; i++) {
      stepWorld(w, HOLD, TICK);
      if (!p.alive) end = "dead";
      else if (p.groundId === "moon") end = "moon";
    }
    assert.equal(end, "moon", `t=${t}`);
  }
});

test("hook a passing comet in flight and you end up riding it", () => {
  for (const t of [20, 100, 180]) {
    const w = world(t), c = w.poses["comet-a"];
    const across = norm(cross(c.vel, [0, 1, 0]));
    const side = norm(cross(across, [0, 1, 0]));
    const eye = sub(c.pos, scale(across, 20));
    // The hook flies straight in the world, so you lead a moving comet: aim where it will be when it arrives.
    const look = norm(sub(add(c.pos, scale(c.vel, 20 / HOOK.fly)), eye));
    const p = float(w, eye, look, add(c.vel, scale(side, 15)));
    let end = null;
    for (let i = 0; i < 6 / TICK && !end; i++) {
      stepWorld(w, HOLD, TICK);
      if (!p.alive) end = "dead";
      else if (p.groundId) end = p.groundId;
    }
    assert.equal(end, "comet-a", `t=${t}`);
  }
});

test("the rope never snaps: a body moving away drags you along", () => {
  const w = world(150), c = w.poses["comet-a"], away = norm(c.vel);
  const p = float(w, sub(c.pos, scale(away, 20)), away, [0, 0, 0]);
  hold(w, p);
  assert.ok(p.hook, "caught");
  const len0 = p.hook.len;
  for (let i = 0; i < 3 / TICK; i++) {
    stepWorld(w, HOLD, TICK);
    if (!p.hook) break; // arrived on the comet
    assert.ok(dist(hitCentre(p), hookAnchor(w, p)) <= len0 + 1e-6);
  }
});

test("letting go keeps your speed, and the hook waits 0.5 s from then", () => {
  const w = world();
  const p = above(w, "giant", 22);
  for (let i = 0; i < 30; i++) stepWorld(w, HOLD, TICK);
  assert.ok(p.hook);
  const before = [...p.vel];
  stepWorld(w, {}, TICK);
  assert.equal(p.hook, null);
  // Only gravity changes the speed on the release tick: no pull, no kick.
  assert.ok(len(sub(p.vel, before)) < 0.25, `changed by ${len(sub(p.vel, before))}`);
  stepWorld(w, HOLD, TICK);
  assert.equal(p.hook, null, "still waiting");
  for (let i = 0; i < HOOK.cooldown / TICK; i++) stepWorld(w, {}, TICK);
  stepWorld(w, HOLD, TICK);
  assert.ok(p.hookShot, "ready again: it flies");
});

test("a rocket blast doesn't break the rope, and dying drops it", () => {
  const w = world(), g = w.poses.giant.pos, r = w.system.byId.giant.radius;
  const p = float(w, add(g, [0, r + 20, 0]), [0, -1, 0], w.poses.giant.vel);
  hold(w, p);
  explode(w, add(hitCentre(p), [1, 0, 0]), "dummy");
  stepWorld(w, HOLD, TICK);
  assert.ok(p.hook, "still hooked");
  p.health = 0;
  stepWorld(w, HOLD, TICK);
  assert.ok(!p.alive);
  assert.equal(p.hook, null);
});

test("hooking empty space or the sun leaves no rope and no NaN", () => {
  const w = world();
  const p = float(w, [0, 300, 0], [0, 1, 0]);
  for (let i = 0; i < 10; i++) stepWorld(w, HOLD, TICK);
  assert.equal(p.hook, null);
  assert.ok(NaNfree(p));
});

test("a press during the wait fires as soon as the wait ends, while still held, and the ring waits too", () => {
  const w = world();
  const p = above(w, "giant", 22);
  for (let i = 0; i < 10; i++) stepWorld(w, HOLD, TICK);
  stepWorld(w, {}, TICK); // let go: the wait starts
  assert.equal(p.hook, null);
  assert.equal(hookable(w, p), false, "no ring while waiting");
  stepWorld(w, HOLD, TICK); // pressed during the wait, then held
  assert.equal(p.hook, null);
  for (let i = 0; i < HOOK.cooldown / TICK + 1 && !p.hookShot && !p.hook; i++) stepWorld(w, HOLD, TICK);
  assert.ok(p.hookShot || p.hook, "fired once the wait was over");
  stepWorld(w, {}, TICK);
  for (let i = 0; i < HOOK.cooldown / TICK + 1; i++) stepWorld(w, {}, TICK);
  assert.equal(hookable(w, p), true, "ring back once ready");
});

test("the hook flies at 50 m/s: a body 10 m off is caught 0.2 s after firing", () => {
  const w = world(), g = w.poses.giant.pos, r = w.system.byId.giant.radius;
  const p = float(w, add(g, [0, r + 10, 0]), [0, -1, 0], w.poses.giant.vel);
  const n = hold(w, p);
  assert.ok(p.hook, "caught");
  assert.ok(Math.abs(n * TICK - 10 / HOOK.fly) <= TICK + 1e-9, `${n} ticks`);
  assert.equal(p.hookShot, null);
});

test("at full range it takes 0.5 s and misses", () => {
  assert.ok(Math.abs(HOOK.range / HOOK.fly - 0.5) < 1e-9);
  const w = world();
  const p = float(w, [0, 300, 0], [0, 1, 0]);
  const n = hold(w, p);
  assert.ok(Math.abs(n * TICK - 0.5) <= TICK + 1e-9, `${n} ticks`);
  assert.equal(p.hook, null);
  assert.equal(p.hookShot, null);
  assert.ok(p.hookCooldown > 0);
});

test("letting go in flight cancels and starts the cooldown", () => {
  const w = world();
  const p = float(w, [0, 300, 0], [0, 1, 0]);
  for (let i = 0; i < 5; i++) stepWorld(w, HOLD, TICK);
  assert.ok(p.hookShot);
  stepWorld(w, {}, TICK);
  assert.equal(p.hookShot, null);
  assert.ok(p.hookCooldown > 0);
});

test("a body that moves out of the hook's line is missed", () => {
  // A fast comet near the sun, aimed at from 24 m: by the time the hook gets there it has moved on.
  let w = null, c = null;
  for (let t = 0; t < 80; t += 0.5) {
    w = world(t);
    c = w.poses["comet-a"];
    if (len(c.vel) * 0.5 > 3 * w.system.byId["comet-a"].radius) break;
  }
  const look = norm(cross(c.vel, [0, 1, 0]));
  const p = float(w, sub(c.pos, scale(look, 24)), look, [0, 0, 0]);
  hold(w, p);
  assert.equal(p.hook, null, "missed");
});

test("a dead player's hook in flight is gone, and a respawn starts with none", () => {
  const w = world(), g = w.poses.giant.pos, r = w.system.byId.giant.radius;
  const p = float(w, add(g, [0, r + 20, 0]), [0, -1, 0]);
  for (let i = 0; i < 3; i++) stepWorld(w, HOLD, TICK);
  assert.ok(p.hookShot);
  p.health = 0;
  stepWorld(w, HOLD, TICK);
  assert.ok(!p.alive);
  assert.equal(p.hookShot, null);
  for (let i = 0; i < 40 && !p.hook; i++) stepWorld(w, HOLD, TICK);
  assert.equal(p.hook, null, "never caught for the dead");
  for (let i = 0; i < (PLAYER.respawn + 0.5) / TICK; i++) stepWorld(w, {}, TICK);
  assert.ok(p.alive);
  assert.equal(p.hookShot, null);
  assert.equal(p.hook, null);
});
