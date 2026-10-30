import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceClip } from "../src/client/synth.js";
import { createAudio } from "../src/client/audio.js";

test("a failed decode is tried again on the next load, not remembered for the session", async () => {
  const warn = console.warn;
  console.warn = () => {};
  let calls = 0;
  // As a browser does, decoding detaches the bytes it was given, so a retry needs bytes of its own.
  const ctx = {
    decodeAudioData: async (b) => {
      if (b.byteLength === 0) throw new Error("detached");
      structuredClone(b, { transfer: [b] });
      if (++calls === 1) throw new Error("bad");
      return { duration: 1 };
    },
  };
  const clip = voiceClip("test", new ArrayBuffer(8)); // the page fetches the file once
  try {
    await clip.load(ctx);
    assert.equal(clip.buffer(), null, "nothing to play yet");
    await clip.load(ctx);
  } finally {
    console.warn = warn;
  }
  assert.equal(calls, 2, "the second load decoded again");
  assert.ok(clip.buffer(), "decoded");
  await clip.load(ctx);
  assert.equal(calls, 2, "a decoded clip is kept");
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

test("the flare's warning is a voice file like the announcer's: 22.05 kHz mono 16-bit, short and small", async () => {
  const { readFileSync } = await import("node:fs");
  const b = readFileSync(new URL("../assets/flare-warning.wav", import.meta.url));
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.equal(v.getUint16(22, true), 1, "mono");
  assert.equal(v.getUint32(24, true), 22050, "22.05 kHz");
  assert.equal(v.getUint16(34, true), 16, "16-bit");
  const secs = v.getUint32(40, true) / 2 / 22050;
  assert.ok(secs > 1 && secs < 2.2, `${secs} s`);
  assert.ok(b.byteLength < 200000);
  const { VOICE_FILES } = await import("../src/client/synth.js");
  assert.ok(VOICE_FILES.includes("flare-warning.wav"), "the page loads it");
});
