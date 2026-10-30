import { test } from "node:test";
import assert from "node:assert/strict";
import { BODIES } from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { bodyPull, gravityAt, dominantBody } from "../src/sim/gravity.js";
import { surfaceInfo } from "../src/sim/collide.js";
import { radiusAt, normalAt } from "../src/sim/shape.js";
import { add, sub, scale, len, dist, norm, dot } from "../src/sim/vec.js";

const system = createSystem(BODIES);
const byId = system.byId;
const spheres = BODIES.filter((b) => b.radius);

// Evenly spread unit directions (Fibonacci sphere), deterministic.
export function directions(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}
const times = Array.from({ length: 121 }, (_, i) => i * 5);

test("on each body's surface its pull is its g", () => {
  const poses = posesAt(system, 10);
  for (const b of spheres) {
    for (const u of directions(20)) {
      const p = add(poses[b.id].pos, scale(u, b.radius));
      assert.ok(Math.abs(len(bodyPull(b, poses[b.id], p)) - b.g) < 1e-9, b.id);
    }
  }
});

test("the tiny planet pulls least at its surface of all planets", () => {
  const planets = spheres.filter((b) => b.kind === "planet");
  const least = planets.reduce((a, b) => (b.g < a.g ? b : a));
  assert.equal(least.id, "tiny");
});

test("1 m above every planet and the moon, that body dominates", () => {
  for (const t of times) {
    const poses = posesAt(system, t);
    for (const b of spheres.filter((b) => b.kind !== "sun")) {
      for (const u of directions(40)) {
        const p = add(poses[b.id].pos, scale(u, b.radius + 1));
        assert.equal(dominantBody(system, poses, p), b.id, `${b.id} at t=${t}`);
      }
    }
  }
});

test("between the tiny and mid orbits, far from every other body, the sun dominates", () => {
  const r = (byId.tiny.orbit.radius + byId.mid.orbit.radius) / 2;
  let checked = 0;
  for (const t of times) {
    const poses = posesAt(system, t);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * 2 * Math.PI, p = [r * Math.cos(a), 0, r * Math.sin(a)];
      // "Far" is four times a body's reach (how far its full pull lasts) from its centre; comets pass here too.
      if (BODIES.some((b) => b.kind !== "sun" && dist(p, poses[b.id].pos) < 4 * b.reach)) continue;
      assert.equal(dominantBody(system, poses, p), "sun");
      checked++;
    }
  }
  assert.ok(checked > 1000);
});

test("10 m above the moon, the heavy planet pulls harder than the moon", () => {
  for (const t of times) {
    const poses = posesAt(system, t);
    for (const u of directions(40)) {
      const p = add(poses.moon.pos, scale(u, byId.moon.radius + 10));
      assert.ok(len(bodyPull(byId.heavy, poses.heavy, p)) > len(bodyPull(byId.moon, poses.moon, p)), `t=${t}`);
    }
  }
});

test("gravityAt sums every pull", () => {
  const poses = posesAt(system, 3), p = [50, 4, 30];
  const sum = BODIES.reduce((acc, b) => add(acc, bodyPull(b, poses[b.id], p)), [0, 0, 0]);
  assert.ok(dist(gravityAt(system, poses, p), sum) < 1e-12);
});

test("inside a body's hold only its own pull counts; beyond twice the hold every pull counts", () => {
  const poses = posesAt(system, 20);
  // Clear of every other body's hold, so only b's hold is in play.
  const clear = (b, p) => BODIES.every((o) => o === b || !(o.hold > 0) || surfaceInfo(o, poses[o.id], p).dist > 2 * o.hold);
  for (const b of BODIES.filter((b) => b.hold > 0 && b.radius)) {
    // h m off the surface where u points (along the slope, as a comet's is lumpy).
    const at = (u, h) => add(add(poses[b.id].pos, scale(u, radiusAt(b, u))), scale(normalAt(b, u), h));
    // Beyond twice the hold: out past the sphere that bounds the body (along a lumpy comet's normal, a nearby
    // bump can be closer than the dent the normal leaves from).
    const out = (u) => add(poses[b.id].pos, scale(u, b.radius + b.hold * 2.1));
    const u = directions(20).find((u) => clear(b, at(u, b.hold * 0.9)) && clear(b, out(u)));
    const inside = at(u, b.hold * 0.9);
    assert.ok(dist(gravityAt(system, poses, inside), bodyPull(b, poses[b.id], inside)) < 1e-12, b.id);
    assert.equal(dominantBody(system, poses, inside), b.id);
    const beyond = out(u);
    const sum = BODIES.reduce((acc, o) => add(acc, bodyPull(o, poses[o.id], beyond)), [0, 0, 0]);
    assert.ok(dist(gravityAt(system, poses, beyond), sum) < 1e-12, b.id);
  }
  assert.ok(BODIES.filter((b) => b.hold > 0).length >= 3);
});
