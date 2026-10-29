import { test } from "node:test";
import assert from "node:assert/strict";
import { SOUND } from "../src/tuning.js";
import { SOUNDS } from "../src/client/sounds.js";
import { RECIPES, LOOPS } from "../src/client/synth.js";
import { audible, admit, limiter, createAudio } from "../src/client/audio.js";

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
