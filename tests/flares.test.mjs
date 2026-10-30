// Solar flares: a schedule from the match clock alone, so the server and every client agree with nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLARE } from "../src/tuning.js";
import { flareAt } from "../src/sim/flares.js";

// Every flare's warning time from 0 to `until` s, walking the clock.
const warnings = (until, step = 0.5) => {
  const seen = [];
  for (let t = 0; t < until; t += step) {
    const f = flareAt(t);
    if (seen.at(-1) !== f.warnAt) seen.push(f.warnAt);
  }
  return seen;
};

test("the schedule is a pure function of the clock", () => {
  for (let t = 0; t < 2000; t += 7.3) assert.deepEqual(flareAt(t), flareAt(t));
});

test("no flare warns before 60 s, and warnings come 60 to 120 s apart", () => {
  const w = warnings(20000);
  assert.ok(w.length > 150, `${w.length} flares`);
  assert.ok(w[0] >= 60, `the first warns at ${w[0]}`);
  for (let i = 1; i < w.length; i++) {
    const gap = w[i] - w[i - 1];
    assert.ok(gap >= 60 && gap <= 120, `gap ${gap} after ${w[i - 1]}`);
  }
});

test("each flare warns 10 s, burns 6 s, then fades 3 s", () => {
  for (const warnAt of warnings(5000).slice(0, 50)) {
    const f = flareAt(warnAt + 0.01);
    assert.equal(f.burnAt, f.warnAt + 10);
    assert.equal(f.endAt, f.burnAt + 6);
    assert.equal(f.phase, "warn");
    assert.equal(flareAt(f.burnAt + 0.01).phase, "burn");
    assert.equal(flareAt(f.endAt + 0.01).phase, "fade");
    assert.equal(flareAt(f.endAt + FLARE.fade + 0.01).phase, "calm");
  }
});

test("a huge clock is as quick as a small one", () => {
  const f = flareAt(1e7);
  assert.ok(Math.abs(f.k - (1e7 - FLARE.first) / FLARE.every) < 2, `k ${f.k}`);
  assert.ok(f.warnAt <= 1e7 + FLARE.every + FLARE.jitter && f.endAt + FLARE.fade > 1e7);
});
