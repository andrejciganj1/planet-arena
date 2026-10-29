import test from "node:test";
import assert from "node:assert/strict";
import { createSettings } from "../src/client/settings.js";

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
