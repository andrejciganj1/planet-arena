import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVoice } from "../src/client/synth.js";
import { createAudio } from "../src/client/audio.js";

test("a failed decode is tried again on the next load, not remembered for the session", async () => {
  const warn = console.warn;
  console.warn = () => {};
  let calls = 0;
  const ctx = { decodeAudioData: async () => { if (++calls === 1) throw new Error("bad"); return { duration: 1 }; } };
  try {
    await loadVoice(ctx, new ArrayBuffer(8));
    await loadVoice(ctx, new ArrayBuffer(8));
  } finally {
    console.warn = warn;
  }
  assert.equal(calls, 2, "the second load decoded again");
  await loadVoice(ctx, new ArrayBuffer(8));
  assert.equal(calls, 2, "a decoded line is kept");
});

test("the engine loads the announcer's voice when the context is made and when it wakes", () => {
  const loaded = [];
  class Ctx {
    constructor() { this.state = "suspended"; }
    resume() { return Promise.resolve(); }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
  }
  const a = createAudio({ AudioContextImpl: Ctx, preloadVoice: (c) => loaded.push(c) });
  a.unlock();
  assert.equal(loaded.length, 1);
  a.unlock();
  assert.equal(loaded.length, 2, "a click on a suspended context asks again (cheap: memoised)");
});
