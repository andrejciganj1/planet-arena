// Run: node tools/comet_search.mjs [seed] [pool]  (defaults take about 50 minutes; prints comet orbits to paste into BODIES in tuning.js)
// Searches each comet's peri, apo, period (a divisor of CYCLE), phase, inc, node, arg and kepler against the
// full-cycle properties in tests/system.test.mjs and tests/world.test.mjs, with margins, so the tests then pass.
import * as tuning from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { createWorld, stepWorld } from "../src/sim/world.js";
import { NO_INPUT, createEntity, standOn } from "../src/sim/entity.js";
import { add, sub, scale, norm, dist, len } from "../src/sim/vec.js";

const { BODIES, CYCLE, COMET, TICK, VOID_RADIUS } = tuning;
const seed = Number(process.argv[2] || 1), POOL = Number(process.argv[3] || 150);
const log = (...a) => console.error(...a);

// Each comet's fastest speed under the old Kepler timing (as in tests/system.test.mjs); the new top speed
// stays within TOP of it, and fastest / slowest stays under RATIO (the test allows 0.75x and 2.5).
const OLD_TOP = { "comet-a": 10.14, "comet-b": 9.16, "comet-c": 3.39, "comet-d": 5.07 };
const TOP = [0.85, 1.1], RATIO = 2.3, ACCEL = 1.5; // m/s^2: the old fastest comet peaked at 1.52 and is rideable
// What each comet is for: two fast ones near the inner planets, the slow one out to the heavy and giant
// planets (a close pass with one of them at least every `hop` s, to hop off onto; the old slow comet's
// longest wait was 350 s), the far one past the far planet's path (and well inside VOID_RADIUS).
const ROLES = {
  "comet-a": { peri: [34, 60], apo: [200, 280] },
  "comet-b": { peri: [34, 60], apo: [200, 280] },
  "comet-c": { peri: [45, 75], apo: [220, 300], hop: 360 },
  "comet-d": { peri: [34, 60], apo: [360, VOID_RADIUS - 60] },
};
const CLEAR = 3.5, WAIT = 110; // m and s, with margin over the tests' 3 and 120

let s = seed >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
const pick = ([lo, hi]) => lo + (hi - lo) * rand();
const round = (x, d) => Number(x.toFixed(d));
const DIVISORS = [];
for (let p = 60; p <= 900; p++) if (CYCLE % p === 0) DIVISORS.push(p);

// The other bodies' positions every 0.1 s over the whole cycle, as the tests sample them.
const others = BODIES.filter((b) => b.kind !== "comet");
const planetIdx = others.map((b, i) => (b.kind === "planet" ? i : -1)).filter((i) => i >= 0);
const hopIdx = ["heavy", "giant"].map((id) => others.findIndex((b) => b.id === id));
const STEPS = CYCLE * 10, NB = others.length;
const table = new Float64Array(STEPS * NB * 3);
{
  const sys = createSystem(others);
  for (let i = 0; i < STEPS; i++) {
    const p = posesAt(sys, i / 10);
    others.forEach((b, k) => table.set(p[b.id].pos, (i * NB + k) * 3));
  }
}
log("table ready");

// One lap of a comet every 0.1 s, plus its speed range and peak acceleration.
function lap(id, orbit) {
  const body = { ...BODIES.find((b) => b.id === id), orbit };
  const sys = createSystem([BODIES[0], body]);
  const n = orbit.period * 10, pos = new Float64Array(n * 3);
  let hi = 0, lo = Infinity, acc = 0;
  for (let i = 0; i < n; i++) {
    const t = i / 10, p = posesAt(sys, t)[id];
    pos.set(p.pos, i * 3);
    const v = len(p.vel);
    (hi = Math.max(hi, v)), (lo = Math.min(lo, v));
    const a = len(sub(posesAt(sys, t + 0.01)[id].vel, posesAt(sys, t - 0.01)[id].vel)) / 0.02;
    acc = Math.max(acc, a);
  }
  return { pos, n, hi, lo, acc };
}

// Smallest gap to any other body over the cycle, giving up once below CLEAR.
function clearance(c) {
  let worst = Infinity;
  for (let i = 0; i < STEPS; i++) {
    const ci = (i % c.n) * 3;
    for (let k = 0; k < NB; k++) {
      const o = (i * NB + k) * 3;
      const g = Math.hypot(c.pos[ci] - table[o], c.pos[ci + 1] - table[o + 1], c.pos[ci + 2] - table[o + 2]) - others[k].radius - 3;
      if (g < worst) if ((worst = g) <= CLEAR) return worst;
    }
  }
  return worst;
}

// Every 0.5 s: is this comet within COMET.close of one of these planets?
function closeness(c, planets = planetIdx) {
  const out = new Uint8Array(CYCLE * 2);
  for (let j = 0; j < out.length; j++) {
    const i = j * 5, ci = (i % c.n) * 3;
    for (const k of planets) {
      const o = (i * NB + k) * 3;
      const g = Math.hypot(c.pos[ci] - table[o], c.pos[ci + 1] - table[o + 1], c.pos[ci + 2] - table[o + 2]) - others[k].radius - 3;
      if (g <= COMET.close) {
        out[j] = 1;
        break;
      }
    }
  }
  return out;
}

function candidate(id) {
  const r = ROLES[id], old = OLD_TOP[id];
  const orbit = { around: "sun", peri: round(pick(r.peri), 1), apo: round(pick(r.apo), 1), period: 100, phase: round(pick([0, 2 * Math.PI]), 3), inc: round(pick([5, 25]), 1), node: Math.floor(pick([0, 360])), arg: Math.floor(pick([0, 360])), kepler: round(pick([0.15, 0.75]), 2) };
  // Random orbits almost never meet the heavy or giant planet often enough, so the slow comet is aimed:
  // one node (where it crosses the planets' plane) on the target's path, and the target's period, so it
  // meets the target there every lap.
  const target = r.hop && others[hopIdx[Math.floor(rand() * hopIdx.length)]];
  if (target) {
    const e = (orbit.apo - orbit.peri) / (orbit.apo + orbit.peri), p = (2 * orbit.peri * orbit.apo) / (orbit.peri + orbit.apo);
    const cv = (p / target.orbit.radius - 1) / e;
    if (Math.abs(cv) > 1) return null;
    const nu = Math.acos(cv) * (rand() < 0.5 ? 1 : -1) + (rand() < 0.5 ? 0 : Math.PI);
    orbit.arg = Math.round((((-nu * 180) / Math.PI) % 360 + 360) % 360);
  }
  // Speed scales as 1 / period, so one lap at 100 s says which periods fit.
  const probe = lap(id, orbit);
  if (probe.hi > RATIO * probe.lo) return null;
  const fits = DIVISORS.filter((p) => {
    const hi = (probe.hi * 100) / p;
    return hi >= TOP[0] * old && hi <= TOP[1] * old && probe.acc * (100 / p) ** 2 <= ACCEL;
  });
  if (!fits.length) return null;
  orbit.period = fits[Math.floor(rand() * fits.length)];
  if (target) {
    if (!fits.includes(target.orbit.period)) return null;
    orbit.period = target.orbit.period;
    // Phase is a shift in time: pick one where the closest approach to the target is a close pass.
    const c0 = lap(id, { ...orbit, phase: 0 }), k = others.indexOf(target), good = [];
    // Only the stretch of the lap near the target's path can come close.
    const near = [];
    for (let j = 0; j < c0.n; j++) {
      const x = c0.pos[j * 3], y = c0.pos[j * 3 + 1], z = c0.pos[j * 3 + 2];
      if (Math.abs(Math.hypot(x, z) - target.orbit.radius) < target.radius + 15 && Math.abs(y) < target.radius + 15) near.push(j);
    }
    for (let sh = 0; sh < c0.n; sh++) {
      let g = Infinity;
      for (const j of near) {
        const ci = j * 3, o = (((j - sh + c0.n) % c0.n) * NB + k) * 3;
        g = Math.min(g, Math.hypot(c0.pos[ci] - table[o], c0.pos[ci + 1] - table[o + 1], c0.pos[ci + 2] - table[o + 2]) - target.radius - 3);
      }
      if (g >= 5 && g <= 8) good.push(sh);
    }
    if (!good.length) return null;
    orbit.phase = round(((good[Math.floor(rand() * good.length)] / c0.n) * 2 * Math.PI) % (2 * Math.PI), 3);
  }
  const c = lap(id, orbit);
  const gap = clearance(c);
  if (gap <= CLEAR) return null;
  if (r.hop && longestWait([closeness(c, hopIdx)]) > r.hop) return null;
  return { id, orbit, ...c, gap, close: closeness(c) };
}

// Longest wait between close passes (flags every 0.5 s, any of them), measured as the test does.
function longestWait(flags) {
  let last = 0, longest = 0;
  for (let j = 0; j < CYCLE * 2; j++) {
    if (flags.some((f) => f[j])) (longest = Math.max(longest, j / 2 - last)), (last = j / 2);
  }
  return Math.max(longest, CYCLE - last);
}

function cometsClear(set) {
  for (let x = 0; x < set.length; x++) {
    for (let y = x + 1; y < set.length; y++) {
      const a = set[x], b = set[y];
      for (let i = 0; i < STEPS; i++) {
        const ai = (i % a.n) * 3, bi = (i % b.n) * 3;
        if (Math.hypot(a.pos[ai] - b.pos[bi], a.pos[ai + 1] - b.pos[bi + 1], a.pos[ai + 2] - b.pos[bi + 2]) - 6 <= CLEAR) return false;
      }
    }
  }
  return true;
}

// The world tests, run on the real sim with this set of comets.
const withSet = (set) => ({ ...tuning, BODIES: BODIES.map((b) => {
  const c = set.find((c) => c.id === b.id);
  return c ? { ...b, orbit: c.orbit } : b;
}) });
function skipTo(w, t) {
  w.t = t;
  w.poses = w.prevPoses = posesAt(w.system, t);
  w.cues = {};
}
function riderOn(tn, t, id, u) {
  const w = createWorld(tn);
  skipTo(w, t);
  w.pads = [];
  w.entities.dummy.alive = false;
  w.entities.dummy.respawnAt = Infinity;
  const p = w.entities.player, b = w.system.byId[id];
  Object.assign(p, createEntity("player", "player", add(w.poses[id].pos, scale(u, b.radius)), u));
  standOn(p, id);
  return { w, p };
}
function rides(tn, id) {
  const { w, p } = riderOn(tn, 0, id, [0, 1, 0]);
  for (let i = 0; i < Math.round(w.system.byId[id].orbit.period / TICK); i++) {
    stepWorld(w, {}, TICK);
    if (!p.alive || p.groundId !== id) return false;
  }
  return true;
}
function hops(tn) {
  const w0 = createWorld(tn), comet = w0.system.byId["comet-c"], passes = [];
  for (const id of ["mid", "heavy", "giant"]) {
    const b = w0.system.byId[id];
    let prev = Infinity, closing = false;
    for (let t = 0; t < 1800; t += 0.25) {
      skipTo(w0, t);
      const gap = dist(w0.poses[comet.id].pos, w0.poses[id].pos) - comet.radius - b.radius;
      if (closing && gap > prev && prev <= COMET.close) passes.push({ id, t: t - 0.25 });
      closing = gap < prev;
      prev = gap;
    }
  }
  if (!passes.length) return false;
  for (const { id, t } of passes) {
    const w = createWorld(tn);
    skipTo(w, t - 3);
    const u = norm(sub(w.poses[id].pos, w.poses[comet.id].pos));
    const { w: rw, p } = riderOn(tn, t - 3, comet.id, u);
    for (let i = 0; i < Math.round(3 / TICK); i++) stepWorld(rw, {}, TICK);
    stepWorld(rw, { player: { ...NO_INPUT, jump: true } }, TICK);
    let end = null;
    for (let i = 0; i < 20 / TICK && !end; i++) {
      stepWorld(rw, {}, TICK);
      if (!p.alive) end = "dead";
      else if (p.groundId) end = p.groundId;
    }
    if (end !== id) return false;
  }
  return passes.length;
}

// 1. A pool of safe candidates per comet. 2. Hill-climb sets for the shortest wait between close passes.
// 3. The best sets in turn: comets clear of each other, then the world tests.
const ids = Object.keys(ROLES);
const pools = {};
for (const id of ids) {
  pools[id] = [];
  let tries = 0;
  while (pools[id].length < (ROLES[id].hop ? Math.ceil(POOL / 3) : POOL)) {
    tries++;
    const c = candidate(id);
    if (c) pools[id].push(c);
  }
  log(`${id}: ${pools[id].length} candidates from ${tries} tries`);
}

const sets = new Map();
for (let restart = 0; restart < 40; restart++) {
  let set = ids.map((id) => pools[id][Math.floor(rand() * pools[id].length)]), best = longestWait(set.map((c) => c.close));
  for (let improved = true; improved; ) {
    improved = false;
    for (let k = 0; k < ids.length; k++) {
      for (const c of pools[ids[k]]) {
        const next = set.map((x, i) => (i === k ? c : x)), w = longestWait(next.map((c) => c.close));
        if (w < best) (set = next), (best = w), (improved = true);
      }
    }
  }
  if (best <= WAIT) sets.set(set.map((c) => pools[c.id].indexOf(c)).join(","), { set, wait: best });
}
const ranked = [...sets.values()].sort((a, b) => a.wait - b.wait);
log(`${ranked.length} sets with waits ${ranked.map((r) => r.wait).join(" ")}`);

const worldOk = new Map(); // per candidate: the other comets barely matter to riding one
const once = (c, f) => (worldOk.has(c) ? worldOk.get(c) : (worldOk.set(c, f()), worldOk.get(c)));
for (const { set, wait } of ranked) {
  if (!cometsClear(set)) continue;
  const tn = withSet(set);
  if (!set.every((c) => once(c, () => rides(tn, c.id) && (c.id !== "comet-c" || hops(tn))))) continue;
  console.log(`// longest wait ${wait} s, closest ${Math.min(...set.map((c) => c.gap)).toFixed(2)} m to a body`);
  for (const c of set) {
    const o = Object.entries(c.orbit).map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : v}`).join(", ");
    console.log(`// ${c.id}: ${c.hi.toFixed(2)} to ${c.lo.toFixed(2)} m/s, peak ${c.acc.toFixed(2)} m/s^2`);
    console.log(`{ id: "${c.id}", orbit: { ${o} } },`);
  }
  process.exit(0);
}
console.log("nothing passed; try another seed or a bigger pool");
process.exit(1);
