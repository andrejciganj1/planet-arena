import { test } from "node:test";
import assert from "node:assert/strict";
import { BODIES } from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { bodyPull, gravityAt, dominantBody } from "../src/sim/gravity.js";
import { surfaceInfo } from "../src/sim/collide.js";
import { add, sub, scale, len, dist, norm, dot } from "../src/sim/vec.js";

const system = createSystem(BODIES);
const byId = system.byId;
const station = BODIES.find((b) => b.kind === "station");
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
// Points 1 m (or h) above the station deck, corners and edges included.
function deckPoints(h) {
  const [w, , d] = station.size, top = station.pos[1] + station.size[1] / 2 + h, out = [];
  for (const fx of [-0.5, -0.25, 0, 0.25, 0.5]) for (const fz of [-0.5, 0, 0.5]) out.push([station.pos[0] + fx * w, top, station.pos[2] + fz * d]);
  return out;
}

test("on each body's surface its pull is its g", () => {
  const poses = posesAt(system, 10);
  for (const b of spheres) {
    for (const u of directions(20)) {
      const p = add(poses[b.id].pos, scale(u, b.radius));
      assert.ok(Math.abs(len(bodyPull(b, poses[b.id], p)) - b.g) < 1e-9, b.id);
    }
  }
  for (const p of deckPoints(0)) assert.ok(Math.abs(len(bodyPull(station, poses.station, p)) - station.g) < 1e-9);
});

test("the tiny planet pulls least at its surface of all planets", () => {
  const planets = spheres.filter((b) => b.kind === "planet");
  const least = planets.reduce((a, b) => (b.g < a.g ? b : a));
  assert.equal(least.id, "tiny");
});

test("1 m above every planet, moon and station deck, that body dominates", () => {
  for (const t of times) {
    const poses = posesAt(system, t);
    for (const b of spheres.filter((b) => b.kind !== "sun")) {
      for (const u of directions(40)) {
        const p = add(poses[b.id].pos, scale(u, b.radius + 1));
        assert.equal(dominantBody(system, poses, p), b.id, `${b.id} at t=${t}`);
      }
    }
    for (const p of deckPoints(1)) assert.equal(dominantBody(system, poses, p), "station", `deck at t=${t}`);
  }
});

test("on the station deck, down is straight into the deck, also at its corners", () => {
  const poses = posesAt(system, 0);
  for (const p of deckPoints(0.5)) {
    const down = norm(bodyPull(station, poses.station, p));
    assert.ok(Math.acos(Math.min(1, dot(down, [0, -1, 0]))) < Math.PI / 180, JSON.stringify(p));
    assert.deepEqual(gravityAt(system, poses, p, "station"), bodyPull(station, poses.station, p));
  }
});

test("between the tiny and mid orbits, far from both, the sun dominates", () => {
  const r = (byId.tiny.orbit.radius + byId.mid.orbit.radius) / 2;
  let checked = 0;
  for (const t of times) {
    const poses = posesAt(system, t);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * 2 * Math.PI, p = [r * Math.cos(a), 0, r * Math.sin(a)];
      // "Far" is four radii from a planet centre (and 30 m from the station).
      if (dist(p, poses.tiny.pos) < 4 * byId.tiny.radius || dist(p, poses.mid.pos) < 4 * byId.mid.radius || dist(p, poses.station.pos) < 30) continue;
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
    const at = (u, h) => add(poses[b.id].pos, scale(u, b.radius + h));
    const u = directions(20).find((u) => clear(b, at(u, b.hold * 0.9)) && clear(b, at(u, b.hold * 2.1)));
    const inside = at(u, b.hold * 0.9);
    assert.ok(dist(gravityAt(system, poses, inside), bodyPull(b, poses[b.id], inside)) < 1e-12, b.id);
    assert.equal(dominantBody(system, poses, inside), b.id);
    const beyond = at(u, b.hold * 2.1);
    const sum = BODIES.reduce((acc, o) => add(acc, bodyPull(o, poses[o.id], beyond)), [0, 0, 0]);
    assert.ok(dist(gravityAt(system, poses, beyond), sum) < 1e-12, b.id);
  }
  assert.ok(BODIES.filter((b) => b.hold > 0).length >= 3);
});
