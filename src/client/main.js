// The page: wires keyboard and mouse into the input, runs the simulation at its fixed tick from real
// time, and draws every frame.
//   ?debug               exposes window.game = { world }
//   ?view=x,y,z,tx,ty,tz fixes a free camera at x,y,z looking at tx,ty,tz (for screenshots)
import * as tuning from "../tuning.js";
import { createWorld, advance } from "../sim/world.js";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";
import { createHud } from "./hud.js";

const params = new URLSearchParams(location.search);
const world = createWorld(tuning);
if (params.has("debug")) window.game = { world };
const view = params.get("view")?.split(",").map(Number);
const canvas = document.getElementById("game");
const renderer = createRenderer(world, canvas, view && view.length === 6 && !view.some(Number.isNaN) ? view : null);
const hud = createHud(document.body);
const input = createInput();

let locked = false;
canvas.addEventListener("click", () => canvas.requestPointerLock());
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) input.onBlur(); // Esc or alt-tab while keys are held must not leave them stuck
});
window.addEventListener("blur", () => input.onBlur());
document.addEventListener("keydown", (e) => {
  if (!locked) return;
  if (e.code === "Space") e.preventDefault();
  if (!e.repeat) input.onKey(e.code, true);
});
document.addEventListener("keyup", (e) => input.onKey(e.code, false));
document.addEventListener("mousemove", (e) => locked && input.onMouseMove(e.movementX, e.movementY));
document.addEventListener("mousedown", (e) => locked && input.onButton(e.button, true));
document.addEventListener("mouseup", (e) => input.onButton(e.button, false));
document.addEventListener("wheel", (e) => locked && input.onWheel(e.deltaY), { passive: true });

let last = performance.now(), acc = 0;
function frame(now) {
  const elapsed = (now - last) / 1000;
  last = now;
  // Only take input on frames that run a tick, so presses and mouse movement are never dropped.
  const ticks = (acc + elapsed) / tuning.TICK + 1e-9 >= 1;
  input.sync(world.entities.player.weapon);
  acc = advance(world, acc, elapsed, ticks && locked ? { player: input.take() } : {});
  for (const ev of world.events) hud.event(ev, world.t);
  world.events.length = 0;
  renderer.draw(Math.min(1, acc / tuning.TICK), locked ? input.pending() : { yaw: 0, pitch: 0 });
  hud.update(world, locked, world.t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
