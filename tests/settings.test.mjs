import test from "node:test";
import assert from "node:assert/strict";
import { createSettings, TOGGLES, toggleText } from "../src/client/settings.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

test("both shown by default", () => {
  const s = createSettings(memory());
  assert.equal(s.get("orbits"), true);
  assert.equal(s.get("cues"), true);
});

test("toggle flips and is remembered by a new settings object on the same storage", () => {
  const store = memory();
  const s = createSettings(store);
  assert.equal(s.toggle("orbits"), false);
  assert.equal(s.get("orbits"), false);
  assert.equal(s.get("cues"), true);
  const again = createSettings(store);
  assert.equal(again.get("orbits"), false);
  assert.equal(again.toggle("orbits"), true);
  assert.equal(createSettings(store).get("orbits"), true);
});

test("a throwing or missing storage gives the defaults and toggles in memory without throwing", () => {
  for (const store of [throwing, undefined, null]) {
    const s = createSettings(store);
    assert.equal(s.get("cues"), true);
    assert.equal(s.toggle("cues"), false);
    assert.equal(s.get("cues"), false);
  }
});

test("a corrupt stored value gives the defaults", () => {
  for (const raw of ["{not json", "42", "null", '{"orbits":"no","cues":0}']) {
    const store = memory();
    store.setItem("planet-arena.settings", raw);
    const s = createSettings(store);
    assert.equal(s.get("orbits"), true, raw);
    assert.equal(s.get("cues"), true, raw);
  }
});

test("sound and hits are on by default and toggle like the others", () => {
  const s = createSettings(memory());
  for (const name of ["sound", "hits"]) {
    assert.equal(s.get(name), true);
    assert.equal(s.toggle(name), false);
    assert.equal(s.get(name), false);
  }
});

test("O, P, M, H and V each toggle a setting and say which way it went", () => {
  assert.deepEqual(TOGGLES, { KeyO: "orbits", KeyP: "cues", KeyM: "sound", KeyH: "hits", KeyV: "third" });
  assert.equal(toggleText("orbits", false), "Orbit lines off");
  assert.equal(toggleText("orbits", true), "Orbit lines on");
  assert.equal(toggleText("cues", false), "Pad cues off");
  assert.equal(toggleText("sound", false), "Sound off");
  assert.equal(toggleText("sound", true), "Sound on");
  assert.equal(toggleText("hits", false), "Hit sound off");
  assert.equal(toggleText("hits", true), "Hit sound on");
});

test("V toggles the third-person view, which starts off", () => {
  const s = createSettings(memory());
  assert.equal(TOGGLES.KeyV, "third");
  assert.equal(s.get("third"), false);
  assert.equal(s.toggle("third"), true);
  assert.equal(toggleText("third", true), "Third person on");
});
