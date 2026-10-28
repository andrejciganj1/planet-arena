// Other players and shots are drawn slightly in the past, between two server snapshots, so their motion is
// smooth whatever the packet timing. Nothing is guessed ahead of the newest snapshot.
import { TICK, NET } from "../tuning.js";
import { posesAt } from "../sim/system.js";
import { sub, lerp, norm, len, scale } from "../sim/vec.js";

// How much of the gap to the target view tick is closed per second of real time.
const NUDGE = 4;
// Snapshots kept: about one second's worth.
const KEEP = 1 / TICK;

export function createInterp(system) {
  const snaps = []; // ascending by tick
  let viewTick = null;

  const newest = () => (snaps.length ? snaps[snaps.length - 1].tick : 0);

  function push(snap) {
    if (snaps.length && snap.tick <= newest()) return; // late or duplicate
    // Snapshot records carry no `rel`; derive it against the poses at the snapshot's own time.
    const poses = posesAt(system, snap.t);
    const entities = {};
    for (const r of snap.entities) {
      const body = r.groundId && poses[r.groundId];
      entities[r.id] = { ...r, rel: body ? sub(r.pos, body.pos) : null };
    }
    snaps.push({ tick: snap.tick, entities, shots: snap.shots || [] });
    while (snaps[0].tick < snap.tick - KEEP) snaps.shift();
    if (viewTick === null) viewTick = snap.tick - NET.interp;
  }

  function mix(a, b, k) {
    // Across a change of body the later record is used whole; lerping would swing through space.
    if (a.groundId !== b.groundId) return b;
    const out = { ...b, up: norm(lerp(a.up, b.up, k)), forward: norm(lerp(a.forward, b.forward, k)) };
    if (a.groundId) {
      // A straight lerp of two offsets cuts through the planet; keep the length so feet stay on the surface.
      const rel = lerp(a.rel, b.rel, k);
      const l = len(rel);
      out.rel = l > 1e-9 ? scale(rel, (len(a.rel) + (len(b.rel) - len(a.rel)) * k) / l) : rel;
      out.pos = lerp(a.pos, b.pos, k);
    } else {
      out.pos = lerp(a.pos, b.pos, k);
    }
    return out;
  }

  function sample(tick) {
    if (!snaps.length) return { entities: {}, shots: [] };
    if (tick <= snaps[0].tick) return snaps[0];
    if (tick >= newest()) return snaps[snaps.length - 1];
    let i = snaps.length - 1;
    while (snaps[i].tick > tick) i--;
    const a = snaps[i], b = snaps[i + 1];
    const k = (tick - a.tick) / (b.tick - a.tick);
    const entities = {};
    for (const [id, rb] of Object.entries(b.entities)) {
      entities[id] = a.entities[id] ? mix(a.entities[id], rb, k) : rb;
    }
    const before = new Map(a.shots.map((s) => [s.id, s]));
    const shots = b.shots.map((s) => {
      const p = before.get(s.id);
      return p ? { ...s, pos: lerp(p.pos, s.pos, k) } : s;
    });
    return { entities, shots };
  }

  const target = () => newest() - NET.interp;

  // Advances the view by real time, nudged towards the target; never past what has arrived.
  function advance(dt) {
    if (viewTick === null) return 0;
    viewTick += dt / TICK;
    viewTick += (target() - viewTick) * Math.min(1, NUDGE * dt);
    viewTick = Math.min(viewTick, newest());
    return viewTick;
  }

  return { push, newest, sample, advance, view: () => viewTick ?? 0 };
}
