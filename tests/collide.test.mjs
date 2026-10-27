import { test } from "node:test";
import assert from "node:assert/strict";
import { PISTOL, TICK } from "../src/tuning.js";
import { createSystem, posesAt } from "../src/sim/system.js";
import { surfaceInfo, sphereContacts, segmentHit, segmentHitsSphere } from "../src/sim/collide.js";
import { add, scale, dist, sub, len } from "../src/sim/vec.js";
import { WITH_STATION } from "./helpers.mjs";

const system = createSystem(WITH_STATION);
const poses = posesAt(system, 42);
const { tiny, mid, station } = system.byId;
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

test("a sphere on the station's edge is pushed out sideways, not up", () => {
  const s = poses.station.pos;
  const centre = [s[0] + station.size[0] / 2 + 0.3, s[1] + 0.2, s[2]];
  const c = sphereContacts(system, poses, centre, 0.5);
  assert.equal(c.length, 1);
  assert.ok(Math.abs(c[0].depth - 0.2) < 1e-9);
  near(c[0].normal, [1, 0, 0]);
  // Inside the box near the side face, the push is still out of that face.
  const inside = surfaceInfo(station, poses.station, [s[0] + station.size[0] / 2 - 0.1, s[1] + 0.2, s[2]]);
  near(inside.normal, [1, 0, 0]);
  assert.ok(Math.abs(inside.dist + 0.1) < 1e-9);
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

test("a segment hits the station deck from above", () => {
  const s = poses.station.pos, top = s[1] + station.size[1] / 2;
  const hit = segmentHit(system, poses, [s[0] + 3, top + 4, s[2]], [s[0] + 3, top - 1, s[2]]);
  assert.equal(hit.id, "station");
  assert.ok(Math.abs(hit.point[1] - top) < 1e-9);
  near(hit.normal, [0, 1, 0]);
});
