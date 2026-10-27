import { test } from "node:test";
import assert from "node:assert/strict";
import { BODIES, CYCLE, COMET, BELT } from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { dist, sub, scale, len } from "../src/sim/vec.js";

const system = createSystem(BODIES);
const spheres = BODIES.filter((b) => b.radius);

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
    }
  }
});

test("the same t gives the same poses", () => {
  assert.deepEqual(posesAt(system, 123.456), posesAt(system, 123.456));
  assert.deepEqual(Object.keys(system.byId).sort(), BODIES.map((b) => b.id).sort());
});

const comets = BODIES.filter((b) => b.kind === "comet");
const gapBetween = (p, a, b) => dist(p[a.id].pos, p[b.id].pos) - a.radius - b.radius;

test("there are three comets, and every orbit period divides CYCLE", () => {
  assert.equal(comets.length, 3);
  for (const b of BODIES.filter((b) => b.orbit)) assert.equal(CYCLE % b.orbit.period, 0, b.id);
});

test("a comet's distance from the sun runs from peri to apo", () => {
  for (const c of comets) {
    let lo = Infinity, hi = 0;
    for (let t = 0; t < c.orbit.period; t += 0.05) {
      const d = len(posesAt(system, t)[c.id].pos);
      (lo = Math.min(lo, d)), (hi = Math.max(hi, d));
    }
    assert.ok(Math.abs(lo - c.orbit.peri) < 0.05 && Math.abs(hi - c.orbit.apo) < 0.05, `${c.id}: ${lo} to ${hi}`);
  }
});

test("a comet is fast near the sun and slow far out", () => {
  for (const c of comets) {
    let near = null, far = null;
    for (let t = 0; t < c.orbit.period; t += 0.05) {
      const p = posesAt(system, t)[c.id], d = len(p.pos);
      if (!near || d < near.d) near = { d, v: len(p.vel) };
      if (!far || d > far.d) far = { d, v: len(p.vel) };
    }
    assert.ok(near.v > 3 * far.v, `${c.id}: ${near.v} near, ${far.v} far`);
  }
});

test("hours into a match, poses repeat exactly every CYCLE", () => {
  for (const t of [1234.5, 20000]) {
    const a = posesAt(system, t), b = posesAt(system, t + CYCLE);
    for (const id of Object.keys(a)) assert.ok(dist(a[id].pos, b[id].pos) < 1e-6, `${id} at ${t}`);
  }
});

test("over the full cycle, no comet comes within 3 m of any body, the sun included", () => {
  let worst = Infinity;
  for (let t = 0; t < CYCLE; t += 0.1) {
    const p = posesAt(system, t);
    for (const c of comets) for (const b of BODIES) if (b !== c) worst = Math.min(worst, gapBetween(p, c, b));
  }
  assert.ok(worst > 3, `closest ${worst}`);
});

test("over the full cycle, some comet passes close to some planet at least every 120 s", () => {
  const planets = BODIES.filter((b) => b.kind === "planet");
  let last = 0, longest = 0;
  for (let t = 0; t < CYCLE; t += 0.5) {
    const p = posesAt(system, t);
    if (comets.some((c) => planets.some((b) => gapBetween(p, c, b) <= COMET.close))) (longest = Math.max(longest, t - last)), (last = t);
  }
  longest = Math.max(longest, CYCLE - last);
  assert.ok(longest <= 120, `longest wait ${longest} s`);
});

test("the asteroid belt stays clear of every planet's and the moon's path", () => {
  // Bands of the orbital plane each body sweeps, from the sun's centre.
  const bands = BODIES.filter((b) => b.kind === "planet").map((b) => [b.id, b.orbit.radius - b.radius, b.orbit.radius + b.radius]);
  const moon = BODIES.find((b) => b.kind === "moon"), around = BODIES.find((b) => b.id === moon.orbit.around);
  bands.push(["moon", around.orbit.radius - moon.orbit.radius - moon.radius, around.orbit.radius + moon.orbit.radius + moon.radius]);
  for (const [id, lo, hi] of bands) assert.ok(BELT.inner - hi >= 3 || lo - BELT.outer >= 3, id);
});
