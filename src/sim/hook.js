// The hook: catch a planet, moon or comet within range along the view and pull yourself to it. The rope
// pulls with a set strength (gravity still acts), never snaps (a body moving away drags you along), and
// letting go keeps your speed, so you can fling yourself off.
import { add, sub, scale, len, dot } from "./vec.js";
import { segmentHit } from "./collide.js";
import { hitCentre, viewDir, unground } from "./entity.js";

// Bodies don't spin, so the caught point rides along at a fixed offset from the body's centre.
export const hookAnchor = (world, e) => add(world.poses[e.hook.body].pos, e.hook.offset);

function release(world, e) {
  e.hook = null;
  e.hookCooldown = world.tuning.HOOK.cooldown;
}

// Fires on a fresh hold. Misses on the sun, on the ground you stand on, and on nothing in range.
function fireHook(world, e) {
  const { HOOK, PLAYER } = world.tuning;
  const eye = add(e.pos, scale(e.up, PLAYER.eye));
  const hit = segmentHit(world.system, world.poses, eye, add(eye, scale(viewDir(e), HOOK.range)));
  if (!hit || world.system.byId[hit.id].kind === "sun" || hit.id === e.groundId) {
    e.hookCooldown = HOOK.cooldown;
    return;
  }
  e.hook = { body: hit.id, offset: sub(hit.point, world.poses[hit.id].pos), len: len(sub(hit.point, hitCentre(e))) };
}

export function stepHook(world, e, held, dt) {
  const { HOOK } = world.tuning;
  e.hookCooldown = Math.max(0, e.hookCooldown - dt);
  const fresh = held && !e.hookHeld;
  e.hookHeld = held;
  if (!held) {
    if (e.hook) release(world, e);
    return;
  }
  if (!e.hook) {
    if (fresh && e.hookCooldown <= 0) fireHook(world, e);
    return;
  }
  if (e.groundId === e.hook.body) return release(world, e); // arrived
  unground(world, e);
  const anchor = hookAnchor(world, e), bodyVel = world.poses[e.hook.body].vel;
  const to = sub(anchor, hitCentre(e)), d = len(to);
  if (d < 1e-6) return;
  const dir = scale(to, 1 / d);
  // Reel in: sideways motion dies away (without it you would circle the body forever), then the pull.
  const rel = sub(e.vel, bodyVel), side = sub(rel, scale(dir, dot(rel, dir)));
  e.vel = sub(e.vel, scale(side, Math.min(1, HOOK.steady * dt)));
  if (dot(sub(e.vel, bodyVel), dir) < HOOK.speed) e.vel = add(e.vel, scale(dir, HOOK.pull * dt));
  // The rope only ever shortens: farther than it allows, you are pulled back onto it and lose the speed
  // carrying you away, so a body moving off drags you with it.
  e.hook.len = Math.min(e.hook.len, d);
  if (d > e.hook.len) {
    e.pos = add(e.pos, scale(dir, d - e.hook.len));
    const out = -dot(sub(e.vel, bodyVel), dir);
    if (out > 0) e.vel = add(e.vel, scale(dir, out));
  }
}
