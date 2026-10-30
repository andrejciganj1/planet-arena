// The hook: it flies out along the view at HOOK.fly m/s, in a straight line in the world from where it was
// fired, and catches the first planet, moon or comet it meets within range (so a body can move out of its
// way). Then it pulls you in: the rope pulls with a set strength (gravity still acts), never snaps (a body
// moving away drags you along), and letting go keeps your speed, so you can fling yourself off.
// e.hookShot is the hook in flight ({ pos, dir, gone: m flown }), e.hook the caught one; never both.
import { add, sub, scale, len, dot } from "./vec.js";
import { segmentHit } from "./collide.js";
import { hitCentre, viewDir, unground } from "./entity.js";

// Bodies don't spin, so the caught point rides along at a fixed offset from the body's centre.
export const hookAnchor = (world, e) => add(world.poses[e.hook.body].pos, e.hook.offset);

// Letting go, a miss or a cancel: the hook is gone and the wait starts, so firing and cancelling can't be spammed.
function release(world, e) {
  e.hook = null;
  e.hookShot = null;
  e.hookCooldown = world.tuning.HOOK.cooldown;
}

// Fires on a fresh hold, from the eye along the view.
function fireHook(world, e) {
  const eye = add(e.pos, scale(e.up, world.tuning.PLAYER.eye));
  e.hookShot = { pos: eye, dir: viewDir(e), gone: 0 };
}

// One tick of flight. Misses on the sun, on the ground you stand on, and once it has flown its range.
function flyHook(world, e, dt) {
  const { HOOK } = world.tuning, s = e.hookShot;
  const step = Math.min(HOOK.fly * dt, HOOK.range - s.gone), to = add(s.pos, scale(s.dir, step));
  const hit = segmentHit(world.system, world.poses, s.pos, to);
  if (hit) {
    if (world.system.byId[hit.id].kind === "sun" || hit.id === e.groundId) return release(world, e);
    e.hookShot = null;
    e.hook = { body: hit.id, offset: sub(hit.point, world.poses[hit.id].pos), len: len(sub(hit.point, hitCentre(e))) };
    return;
  }
  e.hookShot = { pos: to, dir: s.dir, gone: s.gone + step };
  if (e.hookShot.gone >= HOOK.range - 1e-9) release(world, e);
}

export function stepHook(world, e, held, dt) {
  const { HOOK } = world.tuning;
  e.hookCooldown = Math.max(0, e.hookCooldown - dt);
  // A press arms the hook; it fires as soon as the wait is over, while still held, so a press made a
  // moment too early (right after letting go or a miss) isn't swallowed.
  if (held && !e.hookHeld) e.hookArmed = true;
  e.hookHeld = held;
  if (!held) {
    e.hookArmed = false;
    if (e.hook || e.hookShot) release(world, e);
    return;
  }
  if (!e.hook) {
    if (!e.hookShot && e.hookArmed && e.hookCooldown <= 0) {
      e.hookArmed = false;
      fireHook(world, e);
    }
    if (e.hookShot) flyHook(world, e, dt);
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
