import { test } from "node:test";
import assert from "node:assert/strict";
import { createInput } from "../src/client/input.js";
import { NO_INPUT } from "../src/sim/entity.js";
import { CONTROLS } from "../src/tuning.js";

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

test("left mouse fires while held; 1, 2 and the wheel pick weapons", () => {
  const i = createInput();
  i.onButton(0, true);
  assert.equal(i.take().fire, true);
  assert.equal(i.take().fire, true);
  i.onButton(0, false);
  assert.equal(i.take().fire, false);
  i.onKey("Digit2", true);
  assert.equal(i.take().weapon, "rocket");
  assert.equal(i.take().weapon, null);
  i.onKey("Digit1", true);
  assert.equal(i.take().weapon, "pistol");
  i.onWheel(1);
  assert.equal(i.take().weapon, "rocket");
  i.onWheel(1);
  assert.equal(i.take().weapon, "pistol");
});

test("holding space jumps once, so landing while boosting doesn't bounce you off", () => {
  const i = createInput();
  i.onKey("Space", true);
  assert.equal(i.take().jump, true);
  assert.equal(i.take().jump, false);
  assert.equal(i.take().boost, true);
});
