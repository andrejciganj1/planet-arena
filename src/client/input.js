// Keyboard and mouse state turned into the simulation's input records. Pure (no DOM), so it can be
// tested; main.js wires the DOM events to it.
import { CONTROLS } from "../tuning.js";
import { NO_INPUT } from "../sim/entity.js";

const WEAPONS = ["pistol", "rocket"];

export function createInput() {
  const keys = new Set();
  let firing = false, yaw = 0, pitch = 0, jumped = false, weapon = null, selected = "pistol";
  const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
  const pick = (w) => ((selected = w), (weapon = w));
  return {
    onKey(code, down) {
      if (down && code === "Space" && !keys.has("Space")) jumped = true; // a tap between ticks still jumps
      if (down) keys.add(code);
      else keys.delete(code);
      if (down && code === "Digit1") pick("pistol");
      if (down && code === "Digit2") pick("rocket");
    },
    onMouseMove(dx, dy) {
      yaw += dx * CONTROLS.mouse;
      pitch -= dy * CONTROLS.mouse;
    },
    onButton(b, down) {
      if (b === 0) firing = down;
    },
    onWheel(dy) {
      const i = WEAPONS.indexOf(selected) + Math.sign(dy);
      pick(WEAPONS[(i + WEAPONS.length) % WEAPONS.length]);
    },
    // Pointer lock lost or the window lost focus: no key may stay held.
    onBlur() {
      keys.clear();
      firing = false;
      yaw = pitch = 0;
      jumped = false;
      weapon = null;
    },
    // The weapon the player really holds (respawns reset it), so the wheel steps from there.
    sync(current) {
      selected = current;
    },
    // Look not yet handed to the simulation, so the camera can turn every frame.
    pending: () => ({ yaw, pitch }),
    take() {
      const input = {
        ...NO_INPUT,
        move: [axis("KeyD", "KeyA"), axis("KeyW", "KeyS")],
        jump: jumped || keys.has("Space"),
        boost: keys.has("Space"),
        fire: firing,
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
