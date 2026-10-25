import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOST, TICK, PLAYER } from "../src/tuning.js";
import { createEntity, standOn, stepEntity, viewDir, worldVel, NO_INPUT } from "../src/sim/entity.js";
import { makeWorld, assertFrame, directions } from "./helpers.mjs";
import { add, sub, scale, norm, dist, len, dot } from "../src/sim/vec.js";

// An entity standing on body `id` at unit direction u from its centre.
function placeOn(world, id, u, name = "p") {
  const b = world.system.byId[id];
  const e = createEntity(name, "player", add(world.poses[id].pos, scale(u, b.radius)), u);
  standOn(e, id);
  world.entities[name] = e;
  return e;
}
const altitude = (world, e, id) => dist(e.pos, world.poses[id].pos) - world.system.byId[id].radius;
const sunward = (world, id) => norm(sub(world.poses.sun.pos, world.poses[id].pos));

test("standing 10 s on each planet: stays on its spot on the moving surface", () => {
  for (const id of ["tiny", "mid", "heavy", "moon"]) {
    const world = makeWorld(5);
    const e = placeOn(world, id, norm([0.3, 0.8, -0.5]));
    const start = sub(e.pos, world.poses[id].pos);
    world.step(600, NO_INPUT, () => assert.ok(Math.abs(altitude(world, e, id)) < 0.05, id));
    assert.equal(e.groundId, id);
    assert.ok(dist(sub(e.pos, world.poses[id].pos), start) < 0.1, id);
  }
});

test("a jump on the tiny planet comes back down", () => {
  // Includes the sun-facing point, where the sun pulls hardest against the planet.
  for (const t of [0, 40, 80]) {
    const world = makeWorld(t);
    for (const u of [sunward(world, "tiny"), scale(sunward(world, "tiny"), -1), ...directions(6)]) {
      const e = placeOn(world, "tiny", u, "j");
      world.step(1, { ...NO_INPUT, jump: true });
      assert.equal(e.groundId, null, "left the ground");
      let landed = false;
      world.step(300, NO_INPUT, (e) => (landed ||= e.groundId === "tiny"));
      assert.ok(landed, `t=${t} u=${u}`);
    }
  }
});

test("walking ahead 10 s on the mid planet keeps to the surface", () => {
  const world = makeWorld(0);
  const e = placeOn(world, "mid", norm([0.2, 1, 0.1]));
  const startRel = sub(e.pos, world.poses.mid.pos);
  let travelled = 0, last = startRel;
  world.step(600, { ...NO_INPUT, move: [0, 1] }, (e) => {
    assert.ok(Math.abs(altitude(world, e, "mid")) < 0.05);
    assert.equal(e.groundId, "mid");
    const rel = sub(e.pos, world.poses.mid.pos);
    travelled += dist(rel, last);
    last = rel;
  });
  assert.ok(travelled > PLAYER.run * 10 * 0.9, `travelled ${travelled}`);
});

test("running on the tiny planet doesn't fling you off", () => {
  const world = makeWorld(0);
  const e = placeOn(world, "tiny", norm([0.2, 1, 0.1]));
  world.step(600, { ...NO_INPUT, move: [0, 1] }, (e) => assert.equal(e.groundId, "tiny"));
});

test("the booster empties after 1.5 s of thrust and refills on the ground", () => {
  const world = makeWorld(0);
  const u = norm([0, 1, 1]);
  const at = add(world.poses.mid.pos, scale(u, 40));
  const a = (world.entities.a = createEntity("a", "player", at, u));
  const b = (world.entities.b = createEntity("b", "player", at, u));
  const n = Math.round(BOOST.fuel / TICK);
  world.step(n + 30, (e) => (e === a ? { ...NO_INPUT, boost: true } : NO_INPUT), (e, i) => {
    if (e === a && i === n - 2) assert.ok(a.fuel > 0);
  });
  assert.ok(Math.abs(a.fuel) < 1e-9);
  const dv = len(sub(a.vel, b.vel));
  assert.ok(Math.abs(dv - BOOST.accel * BOOST.fuel) < 0.6, `dv ${dv}`);
  // Refill on the ground.
  const g = placeOn(world, "mid", u, "g");
  g.fuel = 0;
  world.step(60);
  assert.ok(Math.abs(g.fuel - BOOST.refill) < 0.02, `fuel ${g.fuel}`);
  world.step(600);
  assert.equal(g.fuel, BOOST.fuel);
});

test("the booster aims where you look, with move", () => {
  const world = makeWorld(0);
  const u = norm([0, 1, 1]);
  const at = add(world.poses.mid.pos, scale(u, 40));
  const a = (world.entities.a = createEntity("a", "player", at, u));
  const b = (world.entities.b = createEntity("b", "player", at, u));
  const look = viewDir(a);
  world.step(10, (e) => (e === a ? { ...NO_INPUT, boost: true, move: [0, 1] } : NO_INPUT));
  assert.ok(dot(norm(sub(a.vel, b.vel)), look) > 0.99);
});

test("falling to another body turns up towards it; forward stays unit and perpendicular", () => {
  const world = makeWorld(0);
  const mid = world.system.byId.mid;
  const e = (world.entities.f = createEntity("f", "player", add(world.poses.mid.pos, [mid.radius + 6, 0, 0]), [0, 1, 0]));
  world.step(180, { ...NO_INPUT, yawDelta: 0.01, pitchDelta: 0.002 }, assertFrame);
  const away = norm(sub(e.pos, world.poses.mid.pos));
  assert.ok(dot(e.up, away) > Math.cos((5 * Math.PI) / 180), `up ${e.up}`);
});

test("up flipping to its opposite leaves a valid frame, no NaN", () => {
  const world = makeWorld(0);
  const mid = world.system.byId.mid;
  // Under the planet with up pointing into it: the target up is exactly opposite.
  const e = (world.entities.f = createEntity("f", "player", add(world.poses.mid.pos, [0, -(mid.radius + 3), 0]), [0, 1, 0]));
  world.step(120, NO_INPUT, assertFrame);
  // The planet moves while you fall, so compare with the way out of it where you landed.
  assert.equal(e.groundId, "mid");
  assert.ok(dot(e.up, norm(sub(e.pos, world.poses.mid.pos))) > Math.cos((5 * Math.PI) / 180), `up ${e.up}`);
});

test("standing on the station deck's corner and on the moon is stable", () => {
  const world = makeWorld(0);
  const st = world.system.byId.station, s = world.poses.station.pos, top = s[1] + st.size[1] / 2;
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i) => {
    const e = createEntity("c" + i, "player", [s[0] + sx * (st.size[0] / 2 - 0.1), top, s[2] + sz * (st.size[2] / 2 - 0.1)], [0, 1, 0]);
    standOn(e, "station");
    return (world.entities[e.id] = e);
  });
  const starts = corners.map((e) => [...e.pos]);
  world.step(600);
  corners.forEach((e, i) => {
    assert.equal(e.groundId, "station");
    assert.ok(dist(e.pos, starts[i]) < 0.05, `corner ${i}`);
  });
  // The moon is covered with the planets in the first test; here, its far side.
  const m = placeOn(world, "moon", norm(sub(world.poses.moon.pos, world.poses.heavy.pos)), "m");
  const rel = sub(m.pos, world.poses.moon.pos);
  world.step(600);
  assert.equal(m.groundId, "moon");
  assert.ok(dist(sub(m.pos, world.poses.moon.pos), rel) < 0.1);
});

test("a planet sweeping into a floating dummy leaves it on the surface, not inside", () => {
  const world = makeWorld(0);
  const mid = world.system.byId.mid;
  const ahead = norm(world.poses.mid.vel);
  const d = createEntity("d", "dummy", add(world.poses.mid.pos, scale(ahead, mid.radius + 0.3)), ahead);
  world.entities.d = d;
  d.vel = [0, 0, 0];
  let grounded = false;
  world.step(120, NO_INPUT, (e) => {
    const centre = add(e.pos, scale(e.up, PLAYER.radius));
    assert.ok(dist(centre, world.poses.mid.pos) > mid.radius + PLAYER.radius - 1e-6, "inside");
    grounded ||= e.groundId === "mid";
  });
  assert.ok(grounded);
});

test("worldVel adds the ground body's velocity", () => {
  const world = makeWorld(0);
  const e = placeOn(world, "mid", [0, 1, 0]);
  assert.deepEqual(worldVel(world, e), world.poses.mid.vel);
  stepEntity(world, e, NO_INPUT, TICK);
  assert.ok(dist(worldVel(world, e), world.poses.mid.vel) < 1e-6);
});
