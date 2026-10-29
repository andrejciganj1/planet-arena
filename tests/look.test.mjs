import test from "node:test";
import assert from "node:assert/strict";
import { loadAssets } from "../src/client/look/assets.js";
import { createQuality } from "../src/client/look/quality.js";
import { LOOK } from "../src/tuning.js";

// A fetch that serves `files` (url -> bytes) and answers 404 for anything else; `offline` urls reject.
const fakeFetch = (files, offline = []) => async (url) => {
  if (offline.includes(url)) throw new TypeError("Failed to fetch");
  if (!(url in files)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, arrayBuffer: async () => files[url] };
};

// Catches console.warn while fn runs.
async function warnings(fn) {
  const seen = [], warn = console.warn;
  console.warn = (...a) => seen.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.warn = warn;
  }
  return seen;
}

test("a failed asset leaves get() null, warns once, and ready resolves", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  let set;
  const seen = await warnings(async () => {
    set = loadAssets(
      [
        { name: "missing", url: "assets/missing.glb" },
        { name: "offline", url: "assets/offline.png" },
        { name: "corrupt", url: "assets/corrupt.glb" },
        { name: "unknown", url: "assets/odd.xyz" },
      ],
      {
        fetchImpl: fakeFetch({ "assets/corrupt.glb": bytes, "assets/odd.xyz": bytes }, ["assets/offline.png"]),
        loaders: { glb: async () => { throw new Error("not a glTF"); }, png: async () => ({}) },
      },
    );
    assert.equal(set.get("missing"), null); // nothing yet, nothing thrown
    await set.ready;
  });
  for (const name of ["missing", "offline", "corrupt", "unknown"]) assert.equal(set.get(name), null);
  assert.deepEqual([...set.failed].sort(), ["assets/corrupt.glb", "assets/missing.glb", "assets/odd.xyz", "assets/offline.png"]);
  assert.equal(seen.length, 4, "one warning per failed file");
  for (const file of set.failed) assert.equal(seen.filter((w) => w.includes(file)).length, 1, `one warning names ${file}`);
});

test("a loaded asset is returned by get()", async () => {
  const bytes = new Uint8Array([7, 7]).buffer, model = { scene: "alien" };
  const started = [];
  const fetchImpl = async (url) => (started.push(url), { ok: true, status: 200, arrayBuffer: async () => bytes });
  const seen = await warnings(async () => {
    const set = loadAssets(
      [{ name: "alien", url: "assets/alien.glb" }, { name: "sky", url: "assets/sky.png" }],
      { fetchImpl, loaders: { glb: async (b) => (assert.equal(b, bytes), model), png: async () => "texture" } },
    );
    assert.deepEqual(started, ["assets/alien.glb", "assets/sky.png"], "every load starts at once");
    await set.ready;
    assert.equal(set.get("alien"), model);
    assert.equal(set.get("sky"), "texture");
    assert.equal(set.get("nobody"), null);
    assert.deepEqual(set.failed, []);
  });
  assert.deepEqual(seen, []);
});

test("quality drops after slow frames, climbs back only after a steady fast stretch, and never flips twice within the window", () => {
  const { down, up, window } = LOOK.quality;
  const q = createQuality({ levels: 3, down, up, window });
  const run = (dt, secs) => {
    const flips = [];
    let level = q.level;
    for (let t = 0; t < secs; t += dt) {
      const now = q.frame(dt);
      if (now !== level) flips.push({ t, from: level, to: now });
      level = now;
    }
    return flips;
  };
  const fast = 1 / 60, slow = down * 1.5;
  assert.equal(q.level, 2, "starts at the top");
  assert.deepEqual(run(fast, 3 * up), [], "fast frames keep the top level");

  // Slow: one level per window at most, and it drops within a few seconds.
  const drops = run(slow, 4 * window);
  assert.ok(drops.length >= 1 && drops[0].t <= 2 * window, `drops within two windows (${drops[0]?.t})`);
  assert.equal(q.level, 0, "keeps dropping while slow, down to the bottom");
  for (let i = 1; i < drops.length; i++) assert.ok(drops[i].t - drops[i - 1].t >= window - 1e-9, "never twice within the window");

  // Fast again: nothing until a steady fast stretch, then one level at a time. Level 1 just failed, so it
  // waits twice `up`.
  const climbs = run(fast, up * 1.9);
  assert.deepEqual(climbs, [], "no climb before 2 `up` s of fast frames");
  // The first window after the slow spell was partly slow, so allow two windows more.
  const later = run(fast, up * 0.1 + 2 * window + 0.1);
  assert.equal(later.length, 1, "one level at a time");
  assert.equal(q.level, 1);

  // A slow spell during the next climb starts the steady stretch again.
  run(fast, up * 0.9);
  run(slow, window * 1.5);
  run(fast, window); // the spell's last window is judged
  const level = q.level;
  assert.deepEqual(run(fast, up * 0.5), [], "the stretch started again after the slow spell");
  assert.equal(q.level, level);

  // Alternating slow and fast windows never flips twice within one window.
  const q2 = createQuality({ levels: 3, down, up, window });
  let last = -Infinity, prev = q2.level, t = 0;
  for (let k = 0; k < 40; k++) {
    const dt = k % 2 ? fast : slow;
    for (let s = 0; s < window * 0.75; s += dt, t += dt) {
      const now = q2.frame(dt);
      if (now !== prev) (assert.ok(t - last >= window - 1e-9, `flipped at ${t} after ${last}`), (last = t));
      prev = now;
    }
  }

  // A long pause (a hidden tab coming back) between ordinary frames is not a slow frame.
  const q3 = createQuality({ levels: 3, down, up, window });
  for (let i = 0; i < 10; i++) {
    q3.frame(5);
    for (let k = 0; k < 120; k++) q3.frame(fast);
  }
  assert.equal(q3.level, 2);
});

test("a machine below 4 fps still drops: a run of long frames counts as slow", () => {
  const { down, up, window, pause } = LOOK.quality;
  const q = createQuality({ levels: 3, ...LOOK.quality });
  let t = 0;
  const dt = pause * 1.3; // about 3 fps
  while (q.level > 0 && t < 10 * window) (q.frame(dt), (t += dt));
  assert.equal(q.level, 0, `at the bottom after ${t.toFixed(1)} s`);
  assert.ok(t <= 3 * window + 2 * dt, `within a few windows (${t.toFixed(1)} s)`);
  assert.ok(down < pause && up > 0);
});

test("a borderline machine (fast one level down, slow at the top) settles on the lower level", () => {
  const { down, up, window, maxUp } = LOOK.quality;
  const q = createQuality({ levels: 3, ...LOOK.quality });
  const fast = 1 / 60, slow = down * 1.5, climbs = [];
  let t = 0, low = 0, prev = q.level;
  for (const total = 20 * 60; t < total; ) {
    const dt = q.level === 2 ? slow : fast;
    const now = q.frame(dt);
    t += dt;
    if (now === 1) low += dt;
    if (now > prev) climbs.push(t);
    prev = now;
  }
  assert.equal(q.level === 1 || q.level === 2, true, "never below the level it is fast at");
  const gaps = climbs.slice(1).map((c, i) => c - climbs[i]);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] >= gaps[i - 1] - window, `each retry waits at least as long (${gaps.map((g) => g.toFixed(0))})`);
  assert.ok(gaps.at(-1) >= maxUp, `retries end up a maxUp apart (${gaps.map((g) => g.toFixed(0))})`);
  assert.ok(climbs.length <= 10, `${climbs.length} climbs in 20 min`);
  assert.ok(low / t >= 0.97, `at the lower level ${(100 * low / t).toFixed(1)} % of the time`);
});

test("a level that holds for maxUp s is trusted again: its next retry waits only twice `up`", () => {
  const { down, up, window, maxUp } = LOOK.quality;
  const q = createQuality({ levels: 3, ...LOOK.quality });
  const fast = 1 / 60, slow = down * 1.5;
  const run = (dtAt, secs) => {
    for (let t = 0; t < secs; t += dtAt(q.level)) q.frame(dtAt(q.level));
  };
  run((l) => (l === 2 ? slow : fast), 6 * 60); // the top fails a few times, its wait grows
  run(() => fast, maxUp + 2 * window); // then the machine is fast everywhere: it climbs back
  assert.equal(q.level, 2);
  run(() => fast, maxUp + 2 * window); // and holds the top for maxUp s
  while (q.level === 2) q.frame(slow); // one slow spell drops it
  assert.equal(q.level, 1);
  let t = 0;
  while (q.level === 1 && t < maxUp) (q.frame(fast), (t += fast));
  assert.equal(q.level, 2);
  assert.ok(t <= 2 * up + 2 * window, `climbed back after ${t.toFixed(1)} s`);
});

test("the sun is in sight unless a body covers it, and half covered reads as partly in sight", async () => {
  const { sunInSight } = await import("../src/client/look/sunsight.js");
  const sun = [0, 0, 0], R = 25, eye = [100, 0, 0];
  assert.equal(sunInSight(eye, sun, R, []), 1);
  assert.equal(sunInSight(eye, sun, R, [{ pos: [0, 200, 0], radius: 10 }]), 1); // off to the side
  assert.equal(sunInSight(eye, sun, R, [{ pos: [300, 0, 0], radius: 50 }]), 1); // behind the eye
  assert.equal(sunInSight(eye, sun, R, [{ pos: [60, 0, 0], radius: 20 }]), 0); // a planet in front
  assert.equal(sunInSight(eye, sun, R, [{ pos: [-100, 0, 0], radius: 20 }]), 1); // behind the sun
  const half = sunInSight(eye, sun, R, [{ pos: [60, 0, -50], radius: 50 }]);
  assert.ok(half > 0.2 && half < 0.8, `half covered: ${half}`);
  // Standing on a planet's night side: the ground hides the sun.
  assert.equal(sunInSight([88, 0, 0], sun, R, [{ pos: [80, 0, 0], radius: 7 }]), 0);
  assert.equal(sunInSight([72.5, 0, 0], sun, R, [{ pos: [80, 0, 0], radius: 7 }]), 1);
});

test("the sky counts as painted only when the bake ran clean and left its colour behind", async () => {
  const { skyPainted } = await import("../src/client/look/skycheck.js");
  const floor = [5, 6, 13, 255]; // the darkest the sky shader paints, read back as sRGB bytes
  assert.equal(skyPainted({ pixel: floor, glError: 0 }), true);
  assert.equal(skyPainted({ pixel: [40, 20, 90, 255], glError: 0 }), true);
  assert.equal(skyPainted({ error: new Error("no context"), pixel: floor, glError: 0 }), false);
  assert.equal(skyPainted({ pixel: floor, glError: 0x0506 }), false); // e.g. an incomplete framebuffer
  assert.equal(skyPainted({ pixel: [0, 0, 0, 255], glError: 0 }), false); // only the clear colour: nothing drew
  assert.equal(skyPainted({ pixel: [0, 0, 0, 0], glError: 0 }), false);
  assert.equal(skyPainted({ pixel: null, glError: 0 }), false);
});
