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

const moons = BODIES.filter((b) => b.kind === "moon");

test("every moon keeps its distance from its planet", () => {
  for (const moon of moons) {
    for (let t = 0; t <= 600; t += 1) {
      const p = posesAt(system, t);
      assert.ok(Math.abs(dist(p[moon.id].pos, p[moon.orbit.around].pos) - moon.orbit.radius) < 1e-6, moon.id);
    }
  }
});

test("there are four moons: one round heavy, two round giant, one round mid", () => {
  const round = (id) => moons.filter((m) => m.orbit.around === id).length;
  assert.equal(moons.length, 4);
  assert.deepEqual([round("heavy"), round("giant"), round("mid")], [1, 2, 1]);
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
  // The whole cycle: the giant's moons cross the heavy planet's band and miss it only by timing.
  for (let t = 0; t < CYCLE; t += 0.5) {
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

test("there are four comets, and every orbit period divides CYCLE", () => {
  assert.equal(comets.length, 4);
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

// Each comet's fastest speed (m/s) under the old Kepler timing, measured before the change to a more even speed.
const keplerTop = { "comet-a": 10.14, "comet-b": 9.16, "comet-c": 3.39, "comet-d": 5.07 };

test("comets keep a more even speed: fastest at most 2.5x slowest, and near the sun about as fast as before", () => {
  for (const c of comets) {
    let lo = Infinity, hi = 0;
    for (let t = 0; t < c.orbit.period; t += 0.05) {
      const v = len(posesAt(system, t)[c.id].vel);
      (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    }
    assert.ok(hi <= 2.5 * lo, `${c.id}: ${hi} fastest, ${lo} slowest`);
    assert.ok(hi >= 0.75 * keplerTop[c.id], `${c.id}: fastest ${hi}, was ${keplerTop[c.id]}`);
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

test("the asteroid belt stays clear of every planet's and moon's path", () => {
  // Bands of the orbital plane each body sweeps, from the sun's centre. (The heavy planet's moon dips into
  // the belt's outer edge, where the owner placed it; the belt is scenery, so it just passes through.)
  const byId = system.byId;
  const planets = BODIES.filter((b) => b.kind === "planet").map((b) => [b.id, b.orbit.radius - b.radius, b.orbit.radius + b.radius]);
  const others = moons.filter((m) => m.id !== "moon").map((m) => {
    const r = byId[m.orbit.around].orbit.radius, d = m.orbit.radius + m.radius;
    return [m.id, r - d, r + d];
  });
  for (const [id, lo, hi] of [...planets, ...others]) assert.ok(BELT.inner - hi >= 3 || lo - BELT.outer >= 3, id);
});

test("an ellipse orbit without kepler times like kepler 1, not NaN", () => {
  const comet = BODIES.find((b) => b.id === "comet-a");
  const make = (orbit) => createSystem(BODIES.map((b) => (b === comet ? { ...b, orbit } : b)));
  const { kepler, ...bare } = comet.orbit;
  const a = make(bare), b = make({ ...bare, kepler: 1 });
  for (const t of [0, 7.5, 123.4]) {
    const p = posesAt(a, t)["comet-a"].pos;
    for (const x of p) assert.ok(Number.isFinite(x), `finite at ${t}`);
    assert.ok(dist(p, posesAt(b, t)["comet-a"].pos) < 1e-9, `equals kepler 1 at ${t}`);
  }
});

test("the faster orbit maths gives the same poses as the original, to a nanometre", async () => {
  const tuning = await import("../src/tuning.js");
  const DEG = Math.PI / 180;
  // The original comet orbit, kept here as the reference.
  const ellipse = ({ peri, apo, period, phase, inc, node, arg, kepler = 1 }, t) => {
    const a = (peri + apo) / 2, e = (apo - peri) / (apo + peri), b = a * Math.sqrt(1 - e * e), n = (2 * Math.PI) / period;
    const M = (((phase + n * t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let E = M;
    const k = kepler * e;
    for (let i = 0; i < 12; i++) E -= (E - k * Math.sin(E) - M) / (1 - k * Math.cos(E));
    const turn = ([x, y]) => {
      const cw = Math.cos(arg * DEG), sw = Math.sin(arg * DEG), ci = Math.cos(inc * DEG), si = Math.sin(inc * DEG);
      const cn = Math.cos(node * DEG), sn = Math.sin(node * DEG);
      const x1 = x * cw - y * sw, z1 = x * sw + y * cw;
      return [x1 * cn - z1 * ci * sn, z1 * si, x1 * sn + z1 * ci * cn];
    };
    return turn([a * (Math.cos(E) - e), b * Math.sin(E)]);
  };
  const system = createSystem(tuning.BODIES);
  for (let t = 0; t < 25200; t += 37.7) {
    const poses = posesAt(system, t);
    for (const b of system.bodies.filter((x) => x.orbit?.peri)) {
      const want = ellipse(b.orbit, t).map((x, i) => x + poses[b.orbit.around].pos[i]);
      assert.ok(Math.hypot(...want.map((x, i) => x - poses[b.id].pos[i])) < 1e-9, `${b.id} at ${t}`);
    }
  }
});

test("changing a comet's orbit in place moves the comet: nothing remembers the old shape", async () => {
  const tuning = await import("../src/tuning.js");
  const bodies = tuning.BODIES.map((b) => ({ ...b, orbit: b.orbit && { ...b.orbit } }));
  const system = createSystem(bodies), comet = bodies.find((b) => b.kind === "comet");
  posesAt(system, 50);
  comet.orbit.period *= 4;
  const fresh = createSystem(bodies.map((b) => ({ ...b, orbit: b.orbit && { ...b.orbit } })));
  assert.ok(dist(posesAt(system, 50)[comet.id].pos, posesAt(fresh, 50)[comet.id].pos) < 1e-9);
});
