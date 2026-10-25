// Jump pads: fixed directions on their bodies (nothing spins), launching whoever steps on them. Whether
// a launch reaches another body depends on where the bodies are, so each pad shows a cue computed by
// flying a stand-in from the pad's centre with the game's own physics. Real launches start from the
// centre too; only a cue refreshed a fraction of a second ago can differ, at the very edge of a window.
import { add, scale, dist, rotateFromTo } from "./vec.js";
import { posesAt } from "./system.js";
import { createEntity, standOn, stepEntity, unground, hitCentre, NO_INPUT } from "./entity.js";
import { surfaceInfo } from "./collide.js";

// Where a pad sits: out from the body's centre along `at` (or its launch direction), on the surface.
export function padPos(world, pad, poses) {
  const body = world.system.byId[pad.body];
  const c = poses[pad.body].pos;
  const at = pad.at || pad.dir;
  if (body.kind !== "station") return add(c, scale(at, body.radius));
  const t = Math.min(...[0, 1, 2].map((i) => (Math.abs(at[i]) > 1e-9 ? body.size[i] / 2 / Math.abs(at[i]) : Infinity)));
  return add(c, scale(at, t));
}

export function launch(world, e, pad) {
  unground(world, e);
  e.vel = add(world.poses[pad.body].vel, scale(pad.dir, pad.speed));
  e.padLockUntil = world.t + world.tuning.PAD.lockout;
  world.events.push({ type: "launch", id: e.id, padId: pad.id });
}

// Grounded entities whose feet are on a pad of the body they stand on get launched.
export function touchPads(world, e) {
  if (!e.groundId || world.t < e.padLockUntil) return;
  for (const pad of world.pads) {
    const at = padPos(world, pad, world.poses);
    if (pad.body === e.groundId && dist(e.pos, at) < world.tuning.PAD.touch) {
      // Launch from the pad's centre, exactly as the cue's stand-in does, so the cue holds for runners.
      const up = surfaceInfo(world.system.byId[pad.body], world.poses[pad.body], at).normal;
      e.forward = rotateFromTo(e.forward, e.up, up);
      Object.assign(e, { pos: at, up });
      launch(world, e, pad);
      return;
    }
  }
}

// Launches a stand-in from the pad at time t and flies it with no input on the future poses.
// landsOn: the first other body it stands on, or null for the sun, the void, home or a timeout.
export function predictLaunch(world, pad, t) {
  const { TICK, PAD_CUE, PLAYER, VOID_RADIUS } = world.tuning;
  const sim = { tuning: world.tuning, system: world.system, t, poses: posesAt(world.system, t), events: [] };
  sim.prevPoses = sim.poses;
  const body = world.system.byId[pad.body];
  const at = padPos(sim, pad, sim.poses);
  const e = createEntity("cue", "dummy", at, surfaceInfo(body, sim.poses[pad.body], at).normal);
  standOn(e, pad.body);
  launch(sim, e, pad);
  const sun = world.system.bodies.find((b) => b.kind === "sun");
  const path = [[...e.pos]];
  const steps = Math.round(PAD_CUE.predict / TICK);
  for (let i = 1; i <= steps; i++) {
    sim.prevPoses = sim.poses;
    sim.t += TICK;
    sim.poses = posesAt(world.system, sim.t);
    stepEntity(sim, e, NO_INPUT, TICK);
    if (i % PAD_CUE.pathEvery === 0) path.push([...e.pos]);
    const c = hitCentre(e), toSun = dist(c, sim.poses[sun.id].pos);
    if (toSun < sun.radius + PLAYER.radius + 1e-6 || toSun > VOID_RADIUS) break;
    if (e.groundId) {
      path.push([...e.pos]);
      return { landsOn: e.groundId === pad.body ? null : e.groundId, path };
    }
  }
  path.push([...e.pos]);
  return { landsOn: null, path };
}

// One pad per tick at most, the stalest first, once its cue is PAD_CUE.refresh old: the predictions
// spread over ticks instead of all landing in one frame.
export function refreshCues(world) {
  let stale = null, oldest = -1;
  for (const pad of world.pads) {
    const cue = world.cues[pad.id];
    const age = cue ? world.t - cue.at : Infinity;
    if (age >= world.tuning.PAD_CUE.refresh && age > oldest) (stale = pad), (oldest = age);
  }
  if (stale) world.cues[stale.id] = { ...predictLaunch(world, stale, world.t), at: world.t };
}
