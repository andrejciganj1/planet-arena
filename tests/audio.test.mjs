import { test } from "node:test";
import assert from "node:assert/strict";
import { SOUND } from "../src/tuning.js";
import { SOUNDS } from "../src/client/sounds.js";
import { RECIPES, LOOPS } from "../src/client/synth.js";
import { audible, admit, limiter, nearest, createAudio } from "../src/client/audio.js";

test("beyond SOUND.range nothing is audible", () => {
  assert.equal(audible(0), true);
  assert.equal(audible(SOUND.near), true);
  assert.equal(audible(SOUND.range), true);
  assert.equal(audible(SOUND.range + 0.01), false);
  assert.equal(audible(1e6), false);
});

test("the limiter admits at most maxVoices and drops a repeat within SOUND.repeat", () => {
  const s = limiter();
  for (let k = 0; k < SOUND.maxVoices; k++) assert.equal(admit(s, `n${k}`, 0), true, `voice ${k}`);
  assert.equal(admit(s, "more", 0), false, "one voice too many");
  // A voice counts until it ends; once the oldest have ended, there is room again.
  assert.equal(admit(s, "more", 10), true);

  const r = limiter();
  assert.equal(admit(r, "minigun", 1), true);
  assert.equal(admit(r, "minigun", 1 + SOUND.repeat / 2), false, "a repeat within SOUND.repeat");
  assert.equal(admit(r, "shotgun", 1 + SOUND.repeat / 2), true, "another name is no repeat");
  assert.equal(admit(r, "minigun", 1 + SOUND.repeat), true, "after SOUND.repeat the name plays again");
  // A dropped repeat doesn't push the next one further away.
  assert.equal(admit(r, "step", 2), true);
  assert.equal(admit(r, "step", 2 + SOUND.repeat * 0.9), false);
  assert.equal(admit(r, "step", 2 + SOUND.repeat * 1.1), true);
});

test("each source's repeats are limited on their own: two miniguns firing together both sound", () => {
  const every = 5 / 60; // the minigun fires every 5 ticks
  for (const offset of [0, 0.01, 0.03, 0.045, 0.06, 0.07]) {
    const s = limiter(), got = { me: 0, you: 0 };
    for (let k = 0; k < 30; k++) {
      for (const [src, t] of [["you", 1 + k * every], ["me", 1 + k * every + offset]]) {
        if (!admit(s, "minigun", t, src)) continue;
        got[src]++;
        s.ends[s.ends.length - 1] = t + 0.2; // play() puts in the voice's real end, as here
      }
    }
    assert.deepEqual(got, { me: 30, you: 30 }, `offset ${offset}`);
  }
  // One player's rapid repeats are still limited.
  const r = limiter();
  assert.equal(admit(r, "step", 1, "me"), true);
  assert.equal(admit(r, "step", 1 + SOUND.repeat / 2, "me"), false);
  assert.equal(admit(r, "step", 1 + SOUND.repeat / 2, "you"), true, "another's step is no repeat of yours");
  // A sound with no source (a chain of blasts) is limited by its name alone.
  assert.equal(admit(r, "explode", 2), true);
  assert.equal(admit(r, "explode", 2 + SOUND.repeat / 2), false);
});

test("a burst of one name never fills more than its share of voices", () => {
  // Ten pellets or a minigun burst in one instant: one voice, not ten.
  const s = limiter();
  let admitted = 0;
  for (let k = 0; k < 10; k++) admitted += admit(s, "shotgun", 5) ? 1 : 0;
  assert.equal(admitted, 1);
});

test("createAudio with a throwing AudioContext does nothing and never throws", () => {
  const sound = { name: "pistol", pos: [1, 2, 3], own: true };
  const loops = new Map([["boost:me", { name: "boost", pos: [0, 0, 0], own: true }]]);
  const exercise = (a) => {
    a.setEnabled(true);
    a.unlock();
    a.unlock();
    a.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0]);
    a.play(sound);
    a.setLoops(loops);
    a.setLoops(new Map());
    a.setEnabled(false);
    a.play(sound);
  };

  let made = 0;
  class Throws { constructor() { made++; throw new Error("no audio here"); } }
  const a = createAudio({ AudioContextImpl: Throws });
  a.play(sound); // before the first click nothing is made
  assert.equal(made, 0);
  assert.doesNotThrow(() => exercise(a));
  assert.equal(made, 1, "a context that failed once is not tried again every click");

  // A context that is made but refuses to resume.
  class NoResume { resume() { throw new Error("blocked"); } }
  assert.doesNotThrow(() => exercise(createAudio({ AudioContextImpl: NoResume })));

  // No Web Audio at all (node).
  assert.doesNotThrow(() => exercise(createAudio({ AudioContextImpl: undefined })));
  assert.doesNotThrow(() => exercise(createAudio()));
});

test("every sound name from sounds.js has a recipe", () => {
  for (const name of SOUNDS) assert.equal(typeof RECIPES[name], "function", `no recipe for ${name}`);
  for (const name of Object.keys(RECIPES)) assert.ok(SOUNDS.includes(name), `${name} is played by nothing`);
  assert.deepEqual([...LOOPS].sort(), ["boost", "hookPull", "rockIncoming", "rocketFlight"]);
});

test("past SOUND.maxLoops only the loops nearest the listener sound", () => {
  const ear = [100, 0, 0];
  const want = new Map();
  // Farthest first, so keeping the first ones would be wrong.
  for (let k = SOUND.maxLoops + 4; k > 0; k--) want.set(`rock:${k}`, { name: "rockIncoming", pos: [100 + k, 0, 0], own: false });
  want.set("boost:me", { name: "boost", pos: null, own: true });
  const kept = nearest(want, ear);
  assert.equal(kept.size, SOUND.maxLoops);
  assert.ok(kept.has("boost:me"), "a loop in your head is nearest of all");
  for (let k = 1; k < SOUND.maxLoops; k++) assert.ok(kept.has(`rock:${k}`), `rock ${k} is among the nearest`);
  assert.ok(!kept.has(`rock:${SOUND.maxLoops}`));
  assert.deepEqual(kept.get("rock:1"), want.get("rock:1"));
  // Within the cap nothing is dropped.
  const few = new Map([...want].slice(0, 3));
  assert.deepEqual([...nearest(few, ear).keys()].sort(), [...few.keys()].sort());
});

test("at the loop cap a playing loop keeps its place unless a newcomer is clearly nearer", () => {
  const ear = [0, 0, 0], max = 2;
  const rock = (x) => ({ name: "rockIncoming", pos: [x, 0, 0], own: false });
  const playing = new Set(["a", "b"]);
  // c is a little nearer than b: b plays on rather than the two swapping every frame.
  const want = new Map([["a", rock(10)], ["b", rock(50)], ["c", rock(50 - SOUND.loopKeep / 2)]]);
  assert.deepEqual([...nearest(want, ear, max, playing).keys()].sort(), ["a", "b"]);
  // Back and forth around b's distance, nothing restarts.
  want.set("c", rock(50 + SOUND.loopKeep / 2));
  assert.deepEqual([...nearest(want, ear, max, playing).keys()].sort(), ["a", "b"]);
  // Nearer by more than the margin: c takes b's place.
  want.set("c", rock(50 - SOUND.loopKeep * 2));
  assert.deepEqual([...nearest(want, ear, max, playing).keys()].sort(), ["a", "c"]);
  // Nothing playing yet: plain nearest.
  want.set("c", rock(50 - SOUND.loopKeep / 2));
  assert.deepEqual([...nearest(want, ear, max).keys()].sort(), ["a", "c"]);
});

test("the engine reports its state for the page check: waiting, running or disabled", () => {
  const param = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  class Fake {
    state = "suspended";
    currentTime = 0;
    destination = {};
    listener = {};
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    createGain() { return node(); }
    createDynamicsCompressor() { return node(); }
  }
  const a = createAudio({ AudioContextImpl: Fake });
  assert.equal(a.state(), "waiting", "nothing is made before the first click");
  a.unlock();
  assert.equal(a.state(), "running");

  class Throws { constructor() { throw new Error("no audio here"); } }
  const b = createAudio({ AudioContextImpl: Throws });
  b.unlock();
  assert.equal(b.state(), "disabled");
  const c = createAudio({ AudioContextImpl: undefined });
  c.unlock();
  assert.equal(c.state(), "disabled");
});
