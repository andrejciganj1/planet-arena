// Your own player, run ahead of the server with your own inputs, so moving, jumping, boosting, hooking and
// switching weapons answer at once. Each snapshot is the truth for its tick: the player is rebuilt from it
// and the inputs since are replayed, and the jump that makes on screen is eased away (or snapped if big).
import { tickClock, stepPlayer } from "../sim/world.js";
import { createEntity, unground, NO_INPUT } from "../sim/entity.js";
import { posesAt } from "../sim/system.js";
import { add, sub, scale, len } from "../sim/vec.js";
import { applyEntity } from "./protocol.js";

const ZERO = [0, 0, 0];

// `view` is the browser's cosmetic world (cosmetic = true, selfId = id).
export function createPrediction(view, id) {
  const { NET, TICK } = view.tuning;
  const smoothTicks = Math.round(NET.smooth / TICK);
  const inputs = new Map(); // tick -> the input predicted with
  const pushes = new Map(); // tick -> your own blasts' pushes, which a replay can't recreate (it fires nothing)
  let off = ZERO, age = 0; // the visual correction when made, and ticks since

  view.onSelfPush = (dv) => {
    if (!pushes.has(view.tick)) pushes.set(view.tick, []);
    pushes.get(view.tick).push(dv);
  };

  // The clock must come from the server's `t` by adding TICK, never tick * TICK, so poses match exactly.
  const after = (t, n) => {
    for (let i = 0; i < n; i++) t += TICK;
    return t;
  };

  function start(tick, t) {
    view.tick = tick;
    view.t = t;
    view.poses = view.prevPoses = posesAt(view.system, t);
    inputs.clear();
    pushes.clear();
  }

  function step(input) {
    tickClock(view, TICK);
    age++;
    const me = view.entities[id];
    if (me?.alive) {
      const n = view.projectiles.length;
      stepPlayer(view, me, input, TICK);
      for (let i = n; i < view.projectiles.length; i++) view.projectiles[i].mine = true;
    }
    inputs.set(view.tick, input);
    // A snapshot older than NET.resync ticks restarts the clock, so older inputs are never replayed.
    inputs.delete(view.tick - NET.resync - 1);
    pushes.delete(view.tick - NET.resync - 1);
  }

  // Steps me from the snapshot's tick to the view's on a scratch clock. Its shots, beams and events go
  // nowhere: your shots were drawn once already, from the live step.
  function replay(me, snap) {
    const sim = { ...view, t: snap.t, tick: snap.tick, poses: posesAt(view.system, snap.t), projectiles: [], beams: [], events: [], explosions: [] };
    for (let k = snap.tick + 1; k <= view.tick; k++) {
      tickClock(sim, TICK);
      // Ticks never predicted (just after a start) ran on the server with nothing from us.
      stepPlayer(sim, me, inputs.get(k) || NO_INPUT, TICK);
      // As in explode, after the step, the way the server orders a tick.
      for (const dv of pushes.get(k) || []) {
        unground(sim, me);
        me.vel = add(me.vel, dv);
      }
    }
  }

  function reconcile(snap) {
    // A hidden tab came back (behind), or snapshots stopped for a while (far ahead): start over.
    if (view.tick - snap.tick > NET.resync || view.tick < snap.tick) start(snap.tick + NET.lead, after(snap.t, NET.lead));
    for (const k of inputs.keys()) if (k <= snap.tick) inputs.delete(k);
    for (const k of pushes.keys()) if (k <= snap.tick) pushes.delete(k);
    const rec = snap.entities.find((r) => r.id === id);
    if (!rec) {
      delete view.entities[id];
      off = ZERO;
      return;
    }
    const was = view.entities[id]?.alive ? view.entities[id].pos : null;
    const me = (view.entities[id] ||= createEntity(id, rec.kind, ZERO, [0, 1, 0]));
    applyEntity(me, rec);
    if (me.alive) replay(me, snap);
    // Drawn where it was, then eased towards the corrected place; a respawn or a big error just jumps.
    const total = was && me.alive ? add(offset(), sub(was, me.pos)) : ZERO;
    off = len(total) > NET.snap ? ZERO : total;
    age = 0;
  }

  const offset = () => scale(off, Math.max(0, 1 - age / smoothTicks));

  return { start, step, reconcile, offset, get me() { return view.entities[id]; } };
}
