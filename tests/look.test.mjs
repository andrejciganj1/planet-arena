import test from "node:test";
import assert from "node:assert/strict";
import { loadAssets } from "../src/client/look/assets.js";
import { createQuality, pixelRatio } from "../src/client/look/quality.js";
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

test("lower quality draws fewer pixels only on a high-density screen, never under one per CSS pixel", () => {
  const levels = LOOK.quality.res.length;
  for (let l = 0; l < levels; l++) {
    assert.equal(pixelRatio(1, l, LOOK.quality), 1, `1x screen, level ${l}`);
    for (const dpr of [1.25, 1.5, 2, 3]) {
      const r = pixelRatio(dpr, l, LOOK.quality);
      assert.ok(r >= 1 && r <= Math.min(dpr, LOOK.quality.most), `${dpr}x screen, level ${l}: ${r}`);
      if (l > 0) assert.ok(r >= pixelRatio(dpr, l - 1, LOOK.quality), `${dpr}x: a higher level never draws fewer pixels`);
    }
  }
  assert.equal(pixelRatio(2, levels - 1, LOOK.quality), 2);
  assert.ok(pixelRatio(2, 0, LOOK.quality) < 2, "a 2x screen steps down");
  assert.equal(pixelRatio(2, 0, LOOK.quality), 1);
  assert.equal(pixelRatio(0.8, 0, LOOK.quality), 0.8, "never over the screen's own (a zoomed-out page)");
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

test("sphereShadow: a point behind a sphere from the sun is shadowed, one beside it is not, the edge is soft", async () => {
  const { sphereShadow } = await import("../src/client/look/shadow.js");
  const sun = [0, 0, 0], R = 25, moon = [100, 0, 0], r = 5;
  // Straight behind the moon, near enough that it hides the whole sun: dark.
  assert.ok(sphereShadow([110, 0, 0], sun, R, moon, r) < 0.05);
  // Beside it, and on the sun's side of it: full light.
  assert.equal(sphereShadow([110, 30, 0], sun, R, moon, r), 1);
  assert.equal(sphereShadow([80, 0, 0], sun, R, moon, r), 1);
  // Inside the sphere: dark.
  assert.equal(sphereShadow([101, 0, 0], sun, R, moon, r), 0);
  // Walking sideways out of the shadow, the light rises smoothly: some points in between, never back down.
  let last = -1, between = 0;
  for (let y = 0; y <= 12; y += 0.25) {
    const k = sphereShadow([110, y, 0], sun, R, moon, r);
    assert.ok(k >= last - 1e-9, `no dip at y ${y}`);
    if (k > 0.05 && k < 0.95) between++;
    last = k;
  }
  assert.ok(between >= 8, `a soft edge, ${between} steps of 0.25 m in between`);
  assert.equal(last, 1);
  // Far behind, the moon covers only part of the sun: never fully dark.
  const far = sphereShadow([1000, 0, 0], sun, R, moon, r);
  assert.ok(far > 0.3 && far < 1, `far behind: ${far}`);
});

test("a blob shadow sits on the ground under a figure and fades as it rises", async () => {
  const { blobUnder } = await import("../src/client/look/shadow.js");
  const bodies = [{ pos: [0, 0, 0], radius: 10 }, { pos: [100, 0, 0], radius: 5 }];
  const b = blobUnder([0, 10, 0], 0.5, bodies);
  assert.deepEqual(b.at.map((x) => Math.round(x * 1e6) / 1e6), [0, 10, 0]);
  const up = blobUnder([0, 12, 0], 0.5, bodies), high = blobUnder([0, 30, 0], 0.5, bodies);
  assert.ok(up.strength < b.strength && up.strength > 0, "fainter a little above");
  assert.ok(up.radius > b.radius, "wider a little above");
  assert.equal(high, null, "none high above");
  // The nearest surface wins: over the small body, the blob is on it.
  const m = blobUnder([94, 0.5, 0], 0.5, bodies);
  assert.ok(Math.abs(Math.hypot(m.at[0] - 100, m.at[1], m.at[2]) - 5) < 1e-9);
});

// The alien. Its model is read straight from the .glb: the JSON chunk for nodes and accessors, the binary
// chunk for vertex positions, so a resized helmet or a body that grows out of its hit sphere fails here.
import { readFileSync } from "node:fs";
import { PLAYER, TICK } from "../src/tuning.js";

function readGlb(file) {
  const buf = readFileSync(new URL(file, import.meta.url));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, "glTF magic");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binAt = 20 + jsonLen;
  const bin = buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt));
  return { json, bin };
}

// A node's matrix as a function on points, through its parents (translation, rotation, scale).
function nodePlacer(json, index) {
  const parent = json.nodes.findIndex((n) => n.children?.includes(index));
  const { translation: t = [0, 0, 0], rotation: q = [0, 0, 0, 1], scale: s = [1, 1, 1] } = json.nodes[index];
  const local = (p) => {
    const v = [p[0] * s[0], p[1] * s[1], p[2] * s[2]];
    const [x, y, z, w] = q;
    const u = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
    const uu = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]];
    return [0, 1, 2].map((i) => v[i] + 2 * (w * u[i] + uu[i]) + t[i]);
  };
  const up = parent >= 0 ? nodePlacer(json, parent) : (p) => p;
  return (p) => up(local(p));
}

// Every vertex of a named node, where the rest pose puts it, and the accessor bounds as given.
function nodeVertices({ json, bin }, name) {
  const index = json.nodes.findIndex((n) => n.name === name);
  assert.ok(index >= 0, `a node named ${name}`);
  const node = json.nodes[index], place = nodePlacer(json, index);
  if (node.mesh === undefined) return { at: place([0, 0, 0]), points: [], bounds: [] };
  const points = [], bounds = [];
  for (const prim of json.meshes[node.mesh].primitives) {
    const acc = json.accessors[prim.attributes.POSITION], view = json.bufferViews[acc.bufferView];
    const stride = view.byteStride || 12, start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    bounds.push({ min: acc.min, max: acc.max });
    for (let i = 0; i < acc.count; i++) {
      const o = start + i * stride;
      points.push(place([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]));
    }
  }
  return { at: place([0, 0, 0]), points, bounds, place };
}

const ALIEN = "../assets/models/alien.glb";
const PARTS = ["head", "eyes", "helmet", "body", "armL", "armR", "legL", "legR", "hand"];
const distTo = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);

test("the exported helmet fits PLAYER.hit.head within 3 %, the body within PLAYER.hit.body", () => {
  const glb = readGlb(ALIEN), { head, body } = PLAYER.hit;
  const hc = [0, head.at, 0], bc = [0, body.at, 0];
  for (const name of PARTS) nodeVertices(glb, name);
  const mats = glb.json.materials.map((m) => m.name);
  for (const m of ["skin", "suit", "trim", "eye", "glass"]) assert.ok(mats.includes(m), `a material named ${m}`);

  // The helmet: its bounds are the head sphere's box, and every vertex lies on that sphere.
  const helmet = nodeVertices(glb, "helmet");
  const lo = [0, 1, 2].map((i) => Math.min(...helmet.points.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...helmet.points.map((p) => p[i])));
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(hi[i] - hc[i] - head.r) <= 0.03 * head.r, `helmet max ${i}: ${hi[i]}`);
    assert.ok(Math.abs(hc[i] - lo[i] - head.r) <= 0.03 * head.r, `helmet min ${i}: ${lo[i]}`);
  }
  // The accessor's own min and max agree (the loader trusts them for culling).
  for (const { min, max } of helmet.bounds) for (let i = 0; i < 3; i++) assert.ok(Math.abs(max[i] - min[i] - 2 * head.r) <= 0.06 * head.r);
  for (const p of helmet.points) assert.ok(Math.abs(distTo(p, hc) - head.r) <= 0.03 * head.r, `helmet vertex off the sphere ${p}`);

  // The head turns in place: its pivot is the helmet's centre, and the face and eyes are inside the glass.
  const skull = nodeVertices(glb, "head");
  assert.ok(distTo(skull.at, hc) < 1e-4, `head pivot ${skull.at}`);
  for (const name of ["head", "eyes"]) {
    for (const p of nodeVertices(glb, name).points) assert.ok(distTo(p, hc) < head.r, `${name} vertex outside the helmet ${p}`);
  }
  // Torso, legs and arms (at rest) inside the body sphere; the feet on the ground, none below it.
  let lowest = Infinity;
  for (const name of ["body", "legL", "legR", "armL", "armR"]) {
    for (const p of nodeVertices(glb, name).points) {
      assert.ok(distTo(p, bc) <= 1.03 * body.r, `${name} vertex outside the body sphere ${p}`);
      lowest = Math.min(lowest, p[1]);
    }
  }
  assert.ok(Math.abs(lowest) < 0.02, `feet at the origin (${lowest})`);
  // The gun goes in the right hand, which moves with the right arm.
  const armR = glb.json.nodes.findIndex((n) => n.name === "armR");
  assert.ok(glb.json.nodes[armR].children?.includes(glb.json.nodes.findIndex((n) => n.name === "hand")), "hand is a child of armR");
});

// The joints the model was built with, read from the file, as placeAlien needs them.
const restOf = (glb) => Object.fromEntries(["body", "head", "armL", "armR", "legL", "legR"].map((n) => [n, nodeVertices(glb, n).at]));

// A grounded or flying entity in the frame of its own figure: up +y, forward -z.
const figureState = (o) => ({
  id: "a", up: [0, 1, 0], forward: [0, 0, -1], vel: [0, 0, 0], pitch: 0, groundId: "mid", airTime: 0, hook: null,
  fuel: 1.5, alive: true, ...o,
});

test("alienPose keeps the head centre on its sphere in every pose", async () => {
  const { alienPose, placeAlien, POSE_KEYS } = await import("../src/client/look/alienpose.js");
  const rest = restOf(readGlb(ALIEN)), hc = [0, PLAYER.hit.head.at, 0];
  const states = [];
  for (const speed of [0, 2, PLAYER.run, 2 * PLAYER.run]) {
    for (const pitch of [-1.55, -0.6, 0, 0.6, 1.55]) {
      for (const hook of [null, { body: "mid", offset: [0, 0, 0] }]) {
        states.push([figureState({ vel: [0, 0, -speed], pitch, hook }), false]);
        for (const airTime of [0, 0.2, 0.5, 1, 3]) {
          for (const boosting of [false, true]) {
            states.push([figureState({ groundId: null, airTime, vel: [speed, -speed, 0], pitch, hook }), boosting]);
          }
        }
      }
    }
  }
  let leaned = 0, swung = 0;
  for (const [e, boosting] of states) {
    for (let t = 0; t < 1; t += 0.05) {
      const pose = alienPose(e, t, boosting);
      for (const k of POSE_KEYS) assert.ok(Number.isFinite(pose[k]), `${k} finite`);
      const placed = placeAlien(pose, rest);
      assert.ok(distTo(placed.head.pos, hc) < 1e-9, `head moved to ${placed.head.pos}`);
      // The body hangs under the head whatever the lean, and stays where shots test it: the drawn torso (its
      // pivot is the body sphere's centre at rest) within a quarter of the body radius of that centre.
      assert.ok(Math.abs(distTo(placed.body.pos, hc) - distTo(rest.body, hc)) < 1e-9);
      const off = distTo(placed.body.pos, [0, PLAYER.hit.body.at, 0]);
      assert.ok(off <= 0.25 * PLAYER.hit.body.r, `the body leans ${off.toFixed(3)} m off its hit sphere (lean ${pose.lean.toFixed(2)})`);
      if (Math.abs(pose.lean) > 0.05) leaned++;
      if (Math.abs(pose.legL - pose.legR) > 0.5) swung++;
    }
  }
  assert.ok(leaned > 0 && swung > 0, "the sweep includes leaning and striding poses");
});

test("poses over a run of interpolated states change smoothly (no jump above a set angle per frame)", async () => {
  const { createPoser, POSE_KEYS } = await import("../src/client/look/alienpose.js");
  const tuning = await import("../src/tuning.js");
  const { createWorld, stepWorld } = await import("../src/sim/world.js");
  const { NO_INPUT, createEntity } = await import("../src/sim/entity.js");
  const { entityState, applyEntity } = await import("../src/net/protocol.js");
  const { createInterp } = await import("../src/net/interp.js");
  // Rad per 60 Hz frame, more reads as a snap: the stride's limbs swing fast by design; the gun arm follows
  // the aim; the lean and the head move slowly, so a step in either shows at once.
  const MAX_STEP = { legL: 0.25, legR: 0.25, armL: 0.25, armR: 0.2, lean: 0.04, headPitch: 0.08 };

  // The server: a player walks, sweeps its aim up and down, jumps, boosts and falls back, for 8 s.
  const world = createWorld(tuning);
  const p = world.entities.player;
  const script = (tick) => {
    const s = tick * TICK;
    return {
      ...NO_INPUT,
      move: s % 4 < 2.5 ? [0, 1] : [1, 0],
      pitchDelta: 3 * TICK * Math.sign(Math.sin(s * 1.3)), // 3 rad/s of mouse, turning round every 2.4 s
      jump: tick % 240 === 60,
      boost: tick % 240 > 75 && tick % 240 < 120,
    };
  };
  const snaps = [];
  for (let tick = 1; tick <= 8 / TICK; tick++) {
    stepWorld(world, { player: script(tick) }, TICK);
    if (tick % tuning.NET.snapEvery === 0) {
      snaps.push({ tick, t: world.t, entities: Object.values(world.entities).map(entityState), shots: [], rocks: [] });
    }
  }

  // The browser: snapshots arrive with jitter (sometimes two at once), frames run at 60 Hz.
  const interp = createInterp(world.system);
  const poser = createPoser();
  const e = createEntity("player", "player", [0, 0, 0], [0, 1, 0]);
  let next = 0, last = null, frames = 0, air = 0, ground = 0, boosted = 0;
  const worst = Object.fromEntries(POSE_KEYS.map((k) => [k, 0]));
  for (let f = 0; f < 7.5 * 60; f++) {
    const now = (f + 1) / 60;
    while (next < snaps.length && snaps[next].t <= now - (next % 5 === 0 ? 0 : 0.012)) interp.push(snaps[next++]);
    const seen = interp.sample(interp.advance(1 / 60)).entities.player;
    if (!seen) continue;
    applyEntity(e, seen);
    if (!e.alive) {
      last = null;
      continue;
    }
    const pose = poser.frame(e, now, 1 / 60);
    if (last) {
      for (const k of POSE_KEYS) worst[k] = Math.max(worst[k], Math.abs(pose[k] - last[k]));
      frames++;
    }
    if (e.groundId) ground++;
    else air++;
    if (poser.boosting(e)) boosted++;
    last = { ...pose };
  }
  assert.ok(frames > 400 && ground > 60 && air > 60 && boosted > 10, `the run walks, flies and boosts (${frames}, ${ground}, ${air}, ${boosted})`);
  for (const k of POSE_KEYS) assert.ok(worst[k] <= MAX_STEP[k], `${k} jumped ${worst[k].toFixed(3)} rad in one frame`);
});

// The weapons. Each is a node named by its weapon with a `<weapon>_muzzle` empty at the barrel's tip, built
// with the grip at its origin and the barrel along -z; its accent material is its pickup colour.
const WEAPONS_GLB = "../assets/models/weapons.glb";

// A node's vertices and those of everything under it, where the file puts them.
function treeVertices(glb, name) {
  const out = [], index = glb.json.nodes.findIndex((n) => n.name === name);
  const walk = (i) => {
    out.push(...nodeVertices(glb, glb.json.nodes[i].name).points);
    for (const c of glb.json.nodes[i].children || []) walk(c);
  };
  walk(index);
  return out;
}

// sRGB hex (as three.js and WEAPON colours take it) to the linear factors glTF stores.
const linear = (hex) => [16, 8, 0].map((s) => {
  const c = ((hex >> s) & 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

test("the weapons file has a node and a muzzle for each of WEAPON_ORDER", async () => {
  const { WEAPON_ORDER } = await import("../src/tuning.js");
  const glb = readGlb(WEAPONS_GLB), { nodes, materials } = glb.json;
  const roots = new Set(glb.json.scenes[glb.json.scene ?? 0].nodes);
  for (const w of WEAPON_ORDER) {
    const index = nodes.findIndex((n) => n.name === w);
    assert.ok(index >= 0 && roots.has(index), `a top-level node named ${w}`);
    const muzzle = nodes.findIndex((n) => n.name === `${w}_muzzle`);
    assert.ok(muzzle >= 0 && nodes[index].children?.includes(muzzle), `${w}_muzzle under ${w}`);
    // The muzzle is ahead of the grip, at the front of the gun: nothing sticks out further forward.
    const at = nodeVertices(glb, `${w}_muzzle`).at, points = treeVertices(glb, w);
    assert.ok(points.length > 100, `${w} has a shape`);
    const front = Math.min(...points.map((p) => p[2]));
    assert.ok(at[2] < -0.1, `${w}'s muzzle ahead of the grip (${at[2]})`);
    assert.ok(Math.abs(front - at[2]) < 0.015, `${w}'s muzzle at its front (${at[2]} against ${front})`);
    // Its accent is the pickup's colour.
    const accent = materials.find((m) => m.name === `${w}_accent`);
    assert.ok(accent, `a material named ${w}_accent`);
    const got = accent.pbrMetallicRoughness.baseColorFactor, want = linear(LOOK.weapons.colors[w]);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) < 0.003, `${w}'s accent is its pickup colour (${got} against ${want})`);
  }
});

// Your own player online, predicted ahead of a room in memory (as tests/predict.test.mjs joins one).
async function onlinePlayer() {
  const tuning = await import("../src/tuning.js");
  const { createWorld } = await import("../src/sim/world.js");
  const { PROTOCOL, snapshot } = await import("../src/net/protocol.js");
  const { createPrediction } = await import("../src/net/predict.js");
  const { createGame } = await import("../server/game.js");
  const json = (x) => JSON.parse(JSON.stringify(x));
  const game = createGame(tuning, { token: () => "tok" });
  const w = game.hello("a", { type: "hello", v: PROTOCOL, name: "A" });
  const view = createWorld(tuning, { solo: false });
  Object.assign(view, { cosmetic: true, selfId: w.id });
  const pred = createPrediction(view, w.id);
  let t = w.t;
  for (let i = 0; i < tuning.NET.lead; i++) t += TICK;
  pred.start(w.tick + tuning.NET.lead, t);
  pred.reconcile(json(snapshot(game.world, { ack: 0, slack: 0, events: [] })));
  return { view, pred, json };
}

test("your weapon in view moves only with your shots: online corrections and a shot count put back never move it", async () => {
  const { createGunWatch, viewGun } = await import("../src/client/look/gunpose.js");
  const { NO_INPUT } = await import("../src/sim/entity.js");
  const { entityState } = await import("../src/net/protocol.js");
  const script = (i) => ({ ...NO_INPUT, move: [0.4, 1], yawDelta: 0.01, fire: i % 90 < 70, jump: i % 120 === 30 });
  // A run of 6 s at 60 frames a second, one tick a frame. `correct` (tick, view, pred, kept) may reconcile.
  const run = async (correct) => {
    const { view, pred, json } = await onlinePlayer();
    const watch = createGunWatch(), placed = [], kept = [];
    let shifted = 0, kicks = 0, most = 0, first = null;
    for (let i = 0; i < 360; i++) {
      pred.step(script(i));
      kept.push(json(entityState(pred.me)));
      kept[i].tick = view.tick;
      kept[i].t = view.t;
      if (correct) correct(i, view, pred, kept, json);
      if (Math.hypot(...pred.offset()) > 0.01) shifted++;
      const { since } = watch.frame(pred.me, (i + 1) / 60);
      if (since === 0) kicks++;
      most = Math.max(most, pred.me.shots);
      first ??= pred.me.shots;
      placed.push(JSON.stringify(viewGun(pred.me.weapon, since)));
    }
    return { placed, shifted, kicks, most, first };
  };
  const clean = await run(null);
  assert.ok(clean.kicks >= 8, `the run fires (${clean.kicks} shots)`);

  // Every 10 ticks the server says where you were 5 ticks ago, 4 m/s off sideways: replayed and eased in.
  const moved = await run((i, view, pred, kept) => {
    if (i % 10 !== 9) return;
    const { tick, t, ...rec } = kept[i - 5];
    pred.reconcile({ tick, t, entities: [{ ...rec, vel: [rec.vel[0] + 4, rec.vel[1], rec.vel[2]] }] });
  });
  assert.ok(moved.shifted > 100, `the corrections shift the view (${moved.shifted} frames)`);
  assert.deepEqual(moved.placed, clean.placed, "the gun in view is placed the same, shifted or not");

  // And sometimes a snapshot is an earlier shot behind at the view's own tick, and the next one has it again.
  const putBack = new Set();
  const behind = await run((i, view, pred, kept) => {
    if (i % 25 === 12 && kept[i].shots > kept[i - 1].shots) return; // a shot this very tick: not yet, so later
    if (i % 25 !== 12 && !(i % 25 === 13 && putBack.has(i - 1))) return;
    if (i % 25 === 12) putBack.add(i);
    const { tick, t, ...rec } = kept[i];
    pred.reconcile({ tick, t, entities: [{ ...rec, shots: rec.shots + (i % 25 === 12 ? -1 : 1) }] });
  });
  assert.ok(putBack.size > 5, `counts put back (${putBack.size})`);
  assert.deepEqual(behind.placed, clean.placed, "a count put back and raised again kicks no second time");
  assert.equal(clean.kicks, clean.most - clean.first, "one kick per shot");
  // Between shots the gun is back at rest: the same placement as never having fired.
  const rest = JSON.stringify(viewGun("pistol", Infinity));
  assert.ok(clean.placed.filter((p) => p === rest).length > 60, "at rest between bursts");
});

test("another's muzzle flashes once per shot fired on the server, seen through snapshots, and briefly", async () => {
  const { createGunWatch, flashShown } = await import("../src/client/look/gunpose.js");
  const tuning = await import("../src/tuning.js");
  const { createWorld, stepWorld } = await import("../src/sim/world.js");
  const { NO_INPUT, createEntity } = await import("../src/sim/entity.js");
  const { entityState, applyEntity } = await import("../src/net/protocol.js");
  const { createInterp } = await import("../src/net/interp.js");
  // The server: a player fires its pistol from 0.5 s to 4 s; 6 s in all.
  const world = createWorld(tuning);
  const p = world.entities.player;
  const snaps = [];
  for (let tick = 1; tick <= 6 / TICK; tick++) {
    stepWorld(world, { player: { ...NO_INPUT, fire: tick * TICK > 0.5 && tick * TICK < 4, move: [0, 1] } }, TICK);
    if (tick % tuning.NET.snapEvery === 0) snaps.push({ tick, t: world.t, entities: Object.values(world.entities).map(entityState), shots: [], rocks: [] });
  }
  assert.ok(p.shots >= 10, `the server fired (${p.shots})`);
  // A browser: snapshots arrive with jitter, frames at 60 Hz.
  const interp = createInterp(world.system), watch = createGunWatch();
  const e = createEntity("player", "player", [0, 0, 0], [0, 1, 0]);
  let next = 0, flashes = 0, shown = 0;
  for (let f = 0; f < 6 * 60; f++) {
    const now = (f + 1) / 60;
    while (next < snaps.length && snaps[next].t <= now - (next % 5 === 0 ? 0 : 0.012)) interp.push(snaps[next++]);
    const seen = interp.sample(interp.advance(1 / 60)).entities.player;
    if (!seen) continue;
    applyEntity(e, seen);
    const { since, gun } = watch.frame(e, now);
    if (since === 0) flashes++, assert.equal(gun, "pistol");
    if (flashShown(since)) shown++;
  }
  assert.equal(flashes, p.shots, "one flash per shot");
  assert.ok(shown <= flashes * Math.ceil(LOOK.weapons.flash.time * 60), `each flash brief (${shown} frames for ${flashes})`);
  assert.ok(shown >= flashes, "each flash seen for a frame at least");
});

// Pickups, pads, rocks and comets (look/proppose.js, assets/models/props.glb from tools/blender/props.py).
const PROPS_GLB = "../assets/models/props.glb";

test("each pickup shows its model: weapons their gun, ammo a crate in the weapon's colour, health and fuel their own", async () => {
  const { pickupModel } = await import("../src/client/look/proppose.js");
  const { PICKUPS, WEAPON_ORDER } = await import("../src/tuning.js");
  const kinds = new Set();
  for (const pk of PICKUPS) {
    const m = pickupModel(pk);
    kinds.add(pk.kind);
    if (pk.kind === "weapon") {
      assert.deepEqual(m, { file: "weapons", node: pk.weapon, tint: null }, pk.id);
      assert.ok(WEAPON_ORDER.includes(m.node), `${pk.id} shows a gun the weapons file has`);
    } else if (pk.kind === "ammo") assert.deepEqual(m, { file: "props", node: "ammo", tint: LOOK.weapons.colors[pk.weapon] }, pk.id);
    else assert.deepEqual(m, { file: "props", node: pk.kind, tint: null }, pk.id);
  }
  assert.deepEqual([...kinds].sort(), ["ammo", "fuel", "health", "weapon"]);
});

test("the props file has each pickup, the pad and four rocks, and each fits where it is drawn", async () => {
  const { ASTEROID } = await import("../src/tuning.js");
  const glb = readGlb(PROPS_GLB), mats = glb.json.materials.map((m) => m.name);
  for (const m of ["ammo_accent", "pad_light"]) assert.ok(mats.includes(m), `a material named ${m}`);
  // Pickups float 1 m up and bob 0.15: within 0.6 m of their centre they never touch the ground.
  for (const name of ["health", "fuel", "ammo"]) {
    for (const p of nodeVertices(glb, name).points) assert.ok(Math.hypot(...p) <= 0.6, `${name} vertex ${p} beyond 0.6 m`);
  }
  // The pad lies almost flat, its plate no wider than the old disc.
  for (const name of ["pad", "pad_arrow"]) nodeVertices(glb, name);
  for (const p of nodeVertices(glb, "pad").points) {
    assert.ok(Math.hypot(p[0], p[2]) <= 1.3 && p[1] >= -0.05 && p[1] <= 0.35, `pad vertex ${p}`);
  }
  // Rocks are unit sized: scaled by ASTEROID.radius a flying one stays inside its hit sphere and fills most of it.
  for (let i = 0; i < 4; i++) {
    const r = nodeVertices(glb, `rock_${i}`).points.map((p) => Math.hypot(...p));
    assert.ok(Math.max(...r) <= 1 && Math.max(...r) >= 0.9, `rock_${i} reaches ${Math.max(...r)}`);
    assert.ok(Math.min(...r) >= 0.6, `rock_${i} dips to ${Math.min(...r)}`);
    assert.ok(Math.max(...r) * ASTEROID.radius <= ASTEROID.radius);
  }
});

test("comet tails point away from the sun: the ion tail straight, the dust tail curving back along the path, both longer near the sun", async () => {
  const { cometTails, tailAt } = await import("../src/client/look/proppose.js");
  const tuning = await import("../src/tuning.js");
  const { createWorld } = await import("../src/sim/world.js");
  const { posesAt } = await import("../src/sim/system.js");
  const { sub, dot, norm, dist, cross, len } = await import("../src/sim/vec.js");
  const system = createWorld(tuning).system;
  const comets = system.bodies.filter((b) => b.kind === "comet");
  assert.ok(comets.length >= 1);
  for (const c of comets) {
    let near = null, far = null;
    for (let t = 0; t < 300; t += 0.5) {
      const poses = posesAt(system, t), { pos, vel } = poses[c.id], sun = poses.sun.pos;
      const tails = cometTails(pos, vel, sun), away = norm(sub(pos, sun)), d = dist(pos, sun);
      const angle = (s, tail) => Math.acos(Math.min(1, dot(norm(sub(tailAt(tail, s), pos)), away)));
      for (const s of [0.25, 0.5, 1]) {
        const ion = tailAt(tails.ion, s), dust = tailAt(tails.dust, s);
        assert.ok(angle(s, tails.ion) < 1e-6, `${c.id} ion tail straight away from the sun at t ${t}`);
        assert.ok(dist(ion, sun) > d && dist(dust, sun) > d, `${c.id} tails reach away from the sun at t ${t}`);
        assert.ok(dot(sub(dust, pos), away) > 0, `${c.id} dust tail ahead of the sun line`);
        // The dust trails behind the comet's motion (across the sun line).
        const sideways = sub(vel, away.map((a) => a * dot(vel, away)));
        if (len(sideways) > 1e-3) assert.ok(dot(sub(dust, ion), sideways) < 0, `${c.id} dust tail lags behind at t ${t}`);
      }
      // Curved: bends further from the sun line along its length; the ion tail doesn't.
      if (len(cross(norm(vel), away)) > 0.05) assert.ok(angle(1, tails.dust) > angle(0.5, tails.dust) + 0.02, `${c.id} dust tail curves at t ${t}`);
      if (!near || d < near.d) near = { d, tails };
      if (!far || d > far.d) far = { d, tails };
    }
    for (const k of ["ion", "dust"]) assert.ok(near.tails[k].length > far.tails[k].length * 1.5, `${c.id} ${k} tail grows near the sun`);
    assert.ok(near.tails.ion.length > near.tails.dust.length, "the ion tail is the long one");
    assert.ok(near.tails.ion.width[1] < near.tails.dust.width[1], "the ion tail is the thin one");
  }
});
