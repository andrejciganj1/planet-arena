// Keyboard and mouse state turned into the simulation's input records. Pure (no DOM), so it can be
// tested; main.js wires the DOM events to it.
import { CONTROLS, WEAPON_ORDER } from "../tuning.js";
import { NO_INPUT } from "../sim/entity.js";

export function createInput() {
  const keys = new Set();
  let firing = false, hooking = false, yaw = 0, pitch = 0, jumped = false, weapon = null, selected = "pistol";
  let held = ["pistol"], lookScale = 1;
  const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
  const pick = (w) => ((selected = w), (weapon = w));
  return {
    onKey(code, down) {
      if (down && code === "Space" && !keys.has("Space")) jumped = true; // a tap between ticks still jumps
      if (down) keys.add(code);
      else keys.delete(code);
      const k = /^Digit([1-6])$/.exec(code);
      if (down && k) pick(WEAPON_ORDER[k[1] - 1]); // the sim ignores weapons you don't hold
    },
    onMouseMove(dx, dy) {
      yaw += dx * CONTROLS.mouse * lookScale;
      pitch -= dy * CONTROLS.mouse * lookScale;
    },
    onButton(b, down) {
      if (b === 0) firing = down;
      if (b === 2) hooking = down;
    },
    // Steps through the weapons you hold, in WEAPON_ORDER.
    onWheel(dy) {
      const mine = WEAPON_ORDER.filter((w) => held.includes(w));
      const i = mine.indexOf(selected) + Math.sign(dy);
      pick(mine[(i + mine.length) % mine.length]);
    },
    // Pointer lock lost or the window lost focus: no key may stay held.
    onBlur() {
      keys.clear();
      firing = hooking = false;
      yaw = pitch = 0;
      jumped = false;
      weapon = null;
    },
    // The weapon in hand and the weapons held (pickups and respawns change them), so the wheel steps
    // from there; zoom (the view's magnification) turns the mouse down by as much.
    sync(current, weapons = held, zoom = 1) {
      if (weapon === null) selected = current; // a pick the sim hasn't seen yet stands (fast screens)
      held = weapons;
      lookScale = 1 / zoom;
    },
    // Look not yet handed to the simulation, so the camera can turn every frame.
    pending: () => ({ yaw, pitch, zoom: keys.has("ShiftLeft") || keys.has("ShiftRight") }),
    take() {
      const input = {
        ...NO_INPUT,
        move: [axis("KeyD", "KeyA"), axis("KeyW", "KeyS")],
        jump: jumped, // a fresh press only: holding space to boost down onto a surface must not bounce you off
        boost: keys.has("Space"),
        fire: firing,
        hook: hooking,
        zoom: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        weapon,
        yawDelta: yaw,
        pitchDelta: pitch,
      };
      yaw = pitch = 0;
      jumped = false;
      weapon = null;
      return input;
    },
  };
}
