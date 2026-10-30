// Irregular comets: a body with a `shape` is a lumpy potato inside its `radius` (sim/shape.js). Walking,
// landing, shots, rockets, the hook and asteroids all meet that surface, not a sphere.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { radiusAt } from "../src/sim/shape.js";
import { surfaceInfo, segmentHit, sphereContacts } from "../src/sim/collide.js";
import { createEntity } from "../src/sim/entity.js";
import { add, sub, scale, norm, len, dot, cross } from "../src/sim/vec.js";
import { makeWorld, directions } from "./helpers.mjs";

const { BODIES, PLAYER, TICK, PISTOL } = tuning;
const system = createSystem(BODIES);
const poses = posesAt(system, 42);
const comets = system.bodies.filter((b) => b.kind === "comet");
const DIRS = directions(400);

test("every comet is a lumpy potato inside its radius, each its own shape; other bodies stay spheres", () => {
  assert.ok(comets.length >= 1 && comets.every((b) => b.shape), "every comet has a shape");
  const profiles = comets.map((b) => {
    const r = DIRS.map((u) => radiusAt(b, u));
    const most = Math.max(...r), least = Math.min(...r);
    assert.ok(most <= b.radius + 1e-9, `${b.id} stays inside its radius (${most})`);
    assert.ok(most > 0.97 * b.radius, `${b.id} fills its radius one way (${most})`);
    assert.ok(least > 0.5 * b.radius, `${b.id} is never thinner than half its radius (${least})`);
    assert.ok(most / least > 1.25, `${b.id} is far from round (${most} / ${least})`);
    return r;
  });
  for (let i = 1; i < profiles.length; i++) assert.notDeepEqual(profiles[i], profiles[0], `${comets[i].id} differs from ${comets[0].id}`);
  for (const b of system.bodies.filter((x) => x.kind !== "comet")) {
    assert.ok(!b.shape, `${b.id} is a sphere`);
    for (const u of DIRS.slice(0, 20)) assert.equal(radiusAt(b, u), b.radius);
  }
});

test("on a comet, surfaceInfo gives the gap to the lumpy surface and its slope's normal", () => {
  for (const b of comets) {
    const c = poses[b.id].pos;
    for (const u of DIRS) {
      const r = radiusAt(b, u);
      const on = surfaceInfo(b, poses[b.id], add(c, scale(u, r)));
      assert.ok(Math.abs(on.dist) < 1e-6, `${b.id}: on the surface (${on.dist})`);
      assert.ok(Math.abs(len(on.normal) - 1) < 1e-9 && dot(on.normal, u) > 0.5, `${b.id}: an outward unit normal`);
      // The normal is square to the surface: two nearby surface points either side lie in its plane.
      const t = norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const step = (s) => { const v = norm(add(u, scale(t, s))); return add(c, scale(v, radiusAt(b, v))); };
      const chord = sub(step(1e-3), step(-1e-3));
      assert.ok(Math.abs(dot(norm(chord), on.normal)) < 0.01, `${b.id}: normal square to the surface`);
      // Off the surface along the normal by h: the gap is h.
      for (const h of [0.3, 1]) {
        const off = surfaceInfo(b, poses[b.id], add(on.point, scale(on.normal, h)));
        assert.ok(Math.abs(off.dist - h) < 0.05 * h + 0.01, `${b.id}: ${h} m off reads ${off.dist}`);
      }
    }
  }
});

test("shots and the hook meet a comet's real surface: in its dents they fly on past the old sphere", () => {
  let dented = 0;
  for (const b of comets) {
    // The comet alone, so no planet passing by gets in the way.
    const only = { bodies: [b], byId: { [b.id]: b } }, c = poses[b.id].pos;
    for (const u of DIRS) {
      const r = radiusAt(b, u), a = add(c, scale(u, b.radius + 20)), end = sub(c, scale(u, 1));
      const hit = segmentHit(only, poses, a, end);
      assert.equal(hit?.id, b.id);
      assert.ok(len(sub(hit.point, add(c, scale(u, r)))) < 0.01, `${b.id}: hits the surface, ${len(sub(hit.point, c))} m from the centre (surface ${r})`);
      if (r < b.radius - 0.3) dented++;
      // A sphere swept along (a rocket, a rock) meets it r early.
      const fat = segmentHit(only, poses, a, end, 0.5);
      assert.ok(Math.abs(len(sub(fat.point, c)) - r - 0.5) < 0.05 + 0.5 * (1 - dot(fat.normal, u)), `${b.id}: a 0.5 m sphere stops 0.5 m out`);
    }
  }
  assert.ok(dented > 100, "plenty of the tests aim into dents");
});

test("a bullet's tick segment that only grazes a comet's bump still hits it", () => {
  const b = comets[0], only = { bodies: [b], byId: { [b.id]: b } }, c = poses[b.id].pos, step = PISTOL.speed * TICK;
  // The comet's widest direction, and a segment 2 cm inside its surface there, square to it.
  const u = DIRS.reduce((best, v) => (radiusAt(b, v) > radiusAt(b, best) ? v : best));
  const t = norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const mid = add(c, scale(u, radiusAt(b, u) - 0.02));
  const hit = segmentHit(only, poses, sub(mid, scale(t, step / 2)), add(mid, scale(t, step / 2)));
  assert.equal(hit?.id, b.id);
});

test("standing on a comet, you rest on its lumpy surface with up along its slope", () => {
  const b = comets[0];
  for (const u of DIRS.filter((_, i) => i % 40 === 0)) {
    const world = makeWorld(30), c = world.poses[b.id];
    const e = (world.entities.e = createEntity("e", "player", add(c.pos, scale(u, b.radius + 0.5)), u));
    e.vel = c.vel.slice();
    world.step(180);
    assert.equal(e.groundId, b.id, "landed");
    const q = world.poses[b.id], s = surfaceInfo(b, q, add(e.pos, scale(e.up, PLAYER.radius)));
    assert.ok(Math.abs(s.dist - PLAYER.radius) < 0.03, `the feet on the surface (gap ${s.dist - PLAYER.radius})`);
    assert.ok(dot(e.up, s.normal) > Math.cos((8 * Math.PI) / 180), "up along the slope");
    assert.equal(sphereContacts(world.system, world.poses, add(e.pos, scale(e.up, PLAYER.radius)), PLAYER.radius - 0.05).length, 0, "not sunk in");
  }
});

test("a comet's gap is the true distance to its surface, near it and a few metres out", () => {
  for (const b of comets) {
    const c = poses[b.id].pos;
    // The truth by brute force: the nearest of 20,000 points on the surface (about 10 cm apart).
    const surface = directions(20000).map((u) => add(c, scale(u, radiusAt(b, u))));
    const truth = (p) => Math.min(...surface.map((q) => len(sub(p, q))));
    for (const u of DIRS.filter((_, i) => i % 8 === 0)) {
      const on = add(c, scale(u, radiusAt(b, u))), n = surfaceInfo(b, poses[b.id], on).normal;
      for (const h of [0.2, 0.5, 2, 4, 6.3, 7.9]) {
        const p = add(on, scale(n, h)), s = surfaceInfo(b, poses[b.id], p).dist, t = truth(p);
        assert.ok(Math.abs(s - t) < 0.01, `${b.id}: ${h} m out along the normal reads ${s.toFixed(3)}, truly ${t.toFixed(3)}`);
      }
    }
  }
});
