import { test } from "node:test";
import assert from "node:assert/strict";
import { createInput } from "../src/client/input.js";
import { NO_INPUT } from "../src/sim/entity.js";
import { CONTROLS, WEAPON_ORDER } from "../src/tuning.js";

test("W and D give move [1, 1]", () => {
  const i = createInput();
  i.onKey("KeyW", true);
  i.onKey("KeyD", true);
  assert.deepEqual(i.take().move, [1, 1]);
  i.onKey("KeyD", false);
  i.onKey("KeyA", true);
  i.onKey("KeyS", true);
  assert.deepEqual(i.take().move, [-1, 0]);
});

test("losing focus releases every key and the fire button", () => {
  const i = createInput();
  i.onKey("KeyW", true);
  i.onKey("Space", true);
  i.onButton(0, true);
  i.onMouseMove(30, -12);
  i.onKey("Digit2", true);
  i.onBlur();
  assert.deepEqual(i.take(), { ...NO_INPUT });
});

test("mouse movement becomes look deltas once, then zero", () => {
  const i = createInput();
  i.onMouseMove(10, 0);
  i.onMouseMove(5, -4);
  const a = i.take();
  assert.ok(Math.abs(a.yawDelta - 15 * CONTROLS.mouse) < 1e-12);
  assert.ok(Math.abs(a.pitchDelta - 4 * CONTROLS.mouse) < 1e-12); // mouse up looks up
  const b = i.take();
  assert.equal(b.yawDelta, 0);
  assert.equal(b.pitchDelta, 0);
});

test("space jumps once per press and boosts while held; a tap between ticks still jumps", () => {
  const i = createInput();
  i.onKey("Space", true);
  i.onKey("Space", false);
  const a = i.take();
  assert.equal(a.jump, true);
  assert.equal(a.boost, false);
  assert.equal(i.take().jump, false);
  i.onKey("Space", true);
  const b = i.take();
  assert.equal(b.boost, true);
  assert.equal(b.jump, true); // a fresh press
});

test("left mouse fires while held", () => {
  const i = createInput();
  i.onButton(0, true);
  assert.equal(i.take().fire, true);
  assert.equal(i.take().fire, true);
  i.onButton(0, false);
  assert.equal(i.take().fire, false);
});

test("keys 1 to 6 pick weapons in WEAPON_ORDER", () => {
  const i = createInput();
  WEAPON_ORDER.forEach((w, k) => {
    i.onKey(`Digit${k + 1}`, true);
    assert.equal(i.take().weapon, w);
    i.onKey(`Digit${k + 1}`, false);
    assert.equal(i.take().weapon, null);
  });
});

test("the wheel cycles only the weapons you hold", () => {
  const i = createInput();
  i.sync("pistol", ["pistol", "rocket", "railgun"]);
  const wheel = (dy) => (i.onWheel(dy), i.take().weapon);
  assert.equal(wheel(1), "rocket");
  assert.equal(wheel(1), "railgun");
  assert.equal(wheel(1), "pistol");
  assert.equal(wheel(-1), "railgun");
  i.sync("pistol", ["pistol"]);
  assert.equal(wheel(1), "pistol");
});

test("right mouse held is the hook; Shift held is zoom; blur clears both", () => {
  const i = createInput();
  i.onButton(2, true);
  i.onKey("ShiftLeft", true);
  let r = i.take();
  assert.equal(r.hook, true);
  assert.equal(r.zoom, true);
  assert.equal(i.take().hook, true, "held, not a one-off");
  i.onBlur();
  r = i.take();
  assert.equal(r.hook, false);
  assert.equal(r.zoom, false);
});

test("zoomed, the mouse turns the view less", () => {
  const i = createInput();
  i.onMouseMove(100, 0);
  const full = i.take().yawDelta;
  i.sync("sniper", ["pistol", "sniper"], 4);
  i.onMouseMove(100, 0);
  assert.ok(Math.abs(i.take().yawDelta - full / 4) < 1e-12);
});

test("holding space jumps once, so landing while boosting doesn't bounce you off", () => {
  const i = createInput();
  i.onKey("Space", true);
  assert.equal(i.take().jump, true);
  assert.equal(i.take().jump, false);
  assert.equal(i.take().boost, true);
});
