// The page: wires keyboard and mouse into the input, runs the game at its fixed tick from real time, and
// draws every frame. Solo runs the whole world here; online asks for a name, then runs your player ahead
// of the server and draws everyone else from its snapshots.
//   ?server=<ws url>     plays online against that server (the page on *.github.io uses config.js's)
//   ?solo                plays solo whatever the address
//   ?debug               exposes window.game = { world } (online: the view world)
//   ?view=x,y,z,tx,ty,tz fixes a free camera at x,y,z looking at tx,ty,tz (for screenshots)
import * as tuning from "../tuning.js";
import { createWorld, advance } from "../sim/world.js";
import { NO_INPUT } from "../sim/entity.js";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";
import { createSettings } from "./settings.js";
import { createHud, askName } from "./hud.js";
import { createOnlineGame, storedName } from "./online.js";
import { SERVER } from "./config.js";

const params = new URLSearchParams(location.search);
const server = params.has("solo") ? null : params.get("server") || (location.hostname.endsWith(".github.io") ? SERVER : null);
const game = server ? createOnlineGame(tuning, server, await askName(document.body, storedName())) : null;
const world = game ? game.world : createWorld(tuning);
const selfId = () => (game ? game.id : "player");
if (params.has("debug")) window.game = { world };
const view = params.get("view")?.split(",").map(Number);
const canvas = document.getElementById("game");
const renderer = createRenderer(world, canvas, view && view.length === 6 && !view.some(Number.isNaN) ? view : null, selfId);
let store = null;
try {
  store = localStorage; // even reading the property throws when storage is blocked
} catch {}
const settings = createSettings(store);
const applyShown = () => renderer.setShown({ orbits: settings.get("orbits"), cues: settings.get("cues") });
applyShown();
const hud = createHud(document.body, !!game);
const input = createInput();

// What covers the game while online and not playing yet (or any more).
function statusText() {
  if (game.outcome === "version") return "A new version is out: reload the page";
  if (game.outcome === "full") return "The game is full";
  if (game.status === "unreachable") return "Can't reach the server, still trying";
  return game.status === "open" && game.me ? null : "Starting the server...";
}

let locked = false;
canvas.addEventListener("click", () => canvas.requestPointerLock());
canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // right mouse is the hook
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) input.onBlur(); // Esc or alt-tab while keys are held must not leave them stuck
});
window.addEventListener("blur", () => {
  input.onBlur();
  hud.scores(false);
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Tab") {
    e.preventDefault(); // focus stays on the game
    hud.scores(true);
  }
  // O and P work on the start screen too; only your own screen changes.
  if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === "KeyO" || e.code === "KeyP")) {
    settings.toggle(e.code === "KeyO" ? "orbits" : "cues");
    applyShown();
  }
  if (!locked) return;
  if (e.code === "Space") e.preventDefault();
  if (!e.repeat) input.onKey(e.code, true);
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Tab") hud.scores(false);
  input.onKey(e.code, false);
});
document.addEventListener("mousemove", (e) => locked && input.onMouseMove(e.movementX, e.movementY));
document.addEventListener("mousedown", (e) => locked && input.onButton(e.button, true));
document.addEventListener("mouseup", (e) => input.onButton(e.button, false));
document.addEventListener("wheel", (e) => locked && input.onWheel(e.deltaY), { passive: true });

let last = performance.now(), acc = 0;
function frame(now) {
  const elapsed = (now - last) / 1000;
  last = now;
  const id = selfId();
  const p = world.entities[id], look = locked ? input.pending() : { yaw: 0, pitch: 0, zoom: false };
  const zoom = p?.alive && p.weapon === "sniper" && look.zoom ? tuning.WEAPONS.sniper.zoom : 1;
  if (p) input.sync(p.weapon, p.weapons, zoom);
  let alpha, shift = null;
  if (game) {
    // Called once per tick the frame runs: each tick's input is sent to the server.
    game.frame(elapsed, () => (locked ? input.take() : NO_INPUT));
    alpha = game.alpha;
    shift = game.offset();
    hud.screen(statusText());
  } else {
    // Only take input on frames that run a tick, so presses and mouse movement are never dropped.
    const ticks = (acc + elapsed) / tuning.TICK + 1e-9 >= 1;
    acc = advance(world, acc, elapsed, ticks && locked ? { player: input.take() } : {});
    alpha = Math.min(1, acc / tuning.TICK);
  }
  // Effects run on real time: the match clock goes back to 0 when the server restarts.
  const secs = now / 1000;
  for (const ev of world.events) {
    hud.event(ev, secs, id, world.players);
    renderer.event(ev, secs);
  }
  world.events.length = 0;
  renderer.draw(alpha, locked ? input.pending() : { yaw: 0, pitch: 0 }, zoom, shift, secs);
  hud.update(world, locked, secs, id, renderer.camera());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
