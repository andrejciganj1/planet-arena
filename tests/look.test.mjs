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

  // Fast again: nothing until a steady fast stretch of `up` s, then one level at a time.
  const climbs = run(fast, up * 0.9);
  assert.deepEqual(climbs, [], "no climb before `up` s of fast frames");
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

  // A long pause (a hidden tab coming back) is not a slow frame.
  const q3 = createQuality({ levels: 3, down, up, window });
  for (let i = 0; i < 10; i++) q3.frame(5);
  assert.equal(q3.level, 2);
});
