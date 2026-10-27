// A bare world for physics tests: the system, poses at t, entities, and step(n) advancing the clock and
// poses each tick the same way stepWorld does.
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { stepEntity, NO_INPUT } from "../src/sim/entity.js";
import { dist, len, dot } from "../src/sim/vec.js";

// The game has no station for now; stations come back with pickups (spec, stage 2). Tests add this one so
// the box code stays covered.
export const TEST_STATION = { id: "station", kind: "station", size: [24, 2, 16], g: 3, reach: 8, hold: 6, orbit: null, pos: [0, 8, -92], color: 0xb8c2cc };
export const WITH_STATION = [...tuning.BODIES, TEST_STATION];

export function makeWorld(t = 0, bodies = tuning.BODIES) {
  const system = createSystem(bodies);
  const poses = posesAt(system, t);
  const world = { tuning, system, t, poses, prevPoses: poses, entities: {}, projectiles: [], explosions: [], pads: [], cues: {}, events: [] };
  // input: a record, or a function (entity, tick) -> record.
  world.step = (n = 1, input = NO_INPUT, each = null) => {
    for (let i = 0; i < n; i++) {
      world.prevPoses = world.poses;
      world.t += tuning.TICK;
      world.poses = posesAt(system, world.t);
      for (const e of Object.values(world.entities)) {
        stepEntity(world, e, typeof input === "function" ? input(e, i) : input, tuning.TICK);
        if (each) each(e, i);
      }
    }
  };
  return world;
}

export const near = (a, b, eps = 1e-9) => assert.ok(dist(a, b) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

export function assertFrame(e) {
  assert.ok(![...e.up, ...e.forward, ...e.pos, ...e.vel, e.pitch].some(Number.isNaN), "NaN in frame");
  assert.ok(Math.abs(len(e.up) - 1) < 1e-6 && Math.abs(len(e.forward) - 1) < 1e-6, "not unit");
  assert.ok(Math.abs(dot(e.up, e.forward)) < 1e-6, "not perpendicular");
}

// Evenly spread unit directions (Fibonacci sphere), deterministic.
export function directions(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}

// Jumps a world's clock to t. Orbits are scripted, so this is exact for the bodies; entities are not
// carried along, so callers re-place the ones they use.
export function skipTo(world, t) {
  world.t = t;
  world.poses = world.prevPoses = posesAt(world.system, t);
  world.cues = {};
}
