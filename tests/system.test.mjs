import { test } from "node:test";
import assert from "node:assert/strict";
import { BODIES } from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { dist, sub, scale, len } from "../src/sim/vec.js";

const system = createSystem(BODIES);
const spheres = BODIES.filter((b) => b.radius);
const station = BODIES.find((b) => b.kind === "station");

// Gap between a sphere's surface and an axis-aligned box.
function boxGap(centre, radius, boxPos, size) {
  const d = centre.map((c, i) => Math.max(Math.abs(c - boxPos[i]) - size[i] / 2, 0));
  return len(d) - radius;
}

test("a planet returns to its start after one period", () => {
  for (const b of spheres.filter((b) => b.orbit && b.orbit.around === "sun")) {
    const a = posesAt(system, 17)[b.id].pos, c = posesAt(system, 17 + b.orbit.period)[b.id].pos;
    assert.ok(dist(a, c) < 1e-6, b.id);
  }
});

test("the moon keeps its distance from its planet", () => {
  const moon = BODIES.find((b) => b.kind === "moon");
  for (let t = 0; t <= 600; t += 1) {
    const p = posesAt(system, t);
    assert.ok(Math.abs(dist(p.moon.pos, p[moon.orbit.around].pos) - moon.orbit.radius) < 1e-6);
  }
});

test("the station never moves", () => {
  for (const t of [0, 13.5, 300]) {
    const p = posesAt(system, t).station;
    assert.deepEqual(p.pos, station.pos);
    assert.deepEqual(p.vel, [0, 0, 0]);
  }
});

test("vel matches the change of pos", () => {
  const h = 1e-4;
  for (const t of [0, 5, 77.7, 400]) {
    const a = posesAt(system, t - h), b = posesAt(system, t + h), p = posesAt(system, t);
    for (const id of Object.keys(p)) {
      const fd = scale(sub(b[id].pos, a[id].pos), 1 / (2 * h));
      assert.ok(dist(fd, p[id].vel) < 1e-3, `${id} at ${t}`);
    }
  }
});

test("no two bodies ever touch", () => {
  for (let t = 0; t <= 600; t += 0.5) {
    const p = posesAt(system, t);
    for (let i = 0; i < spheres.length; i++) {
      for (let j = i + 1; j < spheres.length; j++) {
        const gap = dist(p[spheres[i].id].pos, p[spheres[j].id].pos) - spheres[i].radius - spheres[j].radius;
        assert.ok(gap > 3, `${spheres[i].id}/${spheres[j].id} at ${t}: ${gap}`);
      }
      const gap = boxGap(p[spheres[i].id].pos, spheres[i].radius, station.pos, station.size);
      assert.ok(gap > 3, `${spheres[i].id}/station at ${t}: ${gap}`);
    }
  }
});

test("the same t gives the same poses", () => {
  assert.deepEqual(posesAt(system, 123.456), posesAt(system, 123.456));
  assert.deepEqual(Object.keys(system.byId).sort(), BODIES.map((b) => b.id).sort());
});
