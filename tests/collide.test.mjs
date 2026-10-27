import { test } from "node:test";
import assert from "node:assert/strict";
import { BODIES, PISTOL, TICK } from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { surfaceInfo, sphereContacts, segmentHit, segmentHitsSphere } from "../src/sim/collide.js";
import { add, scale, dist, sub, len } from "../src/sim/vec.js";

const system = createSystem(BODIES);
const poses = posesAt(system, 42);
const { tiny, mid } = system.byId;
const near = (a, b, eps = 1e-9) => assert.ok(dist(a, b) < eps, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test("a sphere sunk 0.2 m into a planet gets depth 0.2 and the outward normal", () => {
  const u = [0.6, 0, 0.8];
  const centre = add(poses.mid.pos, scale(u, mid.radius + 0.3));
  const c = sphereContacts(system, poses, centre, 0.5);
  assert.equal(c.length, 1);
  assert.equal(c[0].id, "mid");
  assert.ok(Math.abs(c[0].depth - 0.2) < 1e-9);
  near(c[0].normal, u);
});

test("a segment crossing a planet hits at its near side", () => {
  const c = poses.mid.pos;
  const a = add(c, [-30, 2, 0]), b = add(c, [30, 2, 0]);
  const hit = segmentHit(system, poses, a, b);
  const want = (30 - Math.sqrt(mid.radius ** 2 - 4)) / 60;
  assert.equal(hit.id, "mid");
  assert.ok(Math.abs(hit.f - want) < 1e-6);
  near(hit.point, add(a, scale(sub(b, a), hit.f)));
  assert.ok(Math.abs(len(hit.normal) - 1) < 1e-9 && hit.normal[0] < 0);
  const fat = segmentHit(system, poses, a, b, 0.5);
  assert.ok(Math.abs(fat.f - (30 - Math.sqrt((mid.radius + 0.5) ** 2 - 4)) / 60) < 1e-6);
});

test("a 120 m/s bullet's tick segment through the tiny planet hits it", () => {
  // Both ends outside, only the middle grazes 2 cm deep: sampling the ends would tunnel through.
  const c = poses.tiny.pos, step = PISTOL.speed * TICK, h = tiny.radius - 0.02;
  const a = add(c, [-step / 2, h, 0]), b = add(c, [step / 2, h, 0]);
  assert.ok(dist(a, c) > tiny.radius && dist(b, c) > tiny.radius);
  const hit = segmentHit(system, poses, a, b);
  assert.equal(hit?.id, "tiny");
});

test("a segment that misses returns null", () => {
  assert.equal(segmentHit(system, poses, [300, 50, 300], [310, 50, 300]), null);
  assert.equal(segmentHitsSphere([0, 0, 0], [10, 0, 0], [5, 2, 0], 1), null);
  assert.ok(Math.abs(segmentHitsSphere([0, 0, 0], [10, 0, 0], [5, 0, 0], 1) - 0.4) < 1e-9);
  assert.equal(segmentHitsSphere([5, 0, 0], [10, 0, 0], [5, 0, 0], 1), 0);
});

