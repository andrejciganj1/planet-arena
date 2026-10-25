import { test } from "node:test";
import assert from "node:assert/strict";
import { add, sub, scale, dot, cross, len, norm, dist, lerp, projectOnPlane, rotateFromTo, rotateAxis, clampLen } from "../src/sim/vec.js";

export const near = (a, b, eps = 1e-9) =>
  assert.ok(a.every((x, i) => Math.abs(x - b[i]) < eps), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test("basic arithmetic returns new arrays", () => {
  const a = [1, 2, 3];
  near(add(a, [1, 1, 1]), [2, 3, 4]);
  near(sub(a, [1, 1, 1]), [0, 1, 2]);
  near(scale(a, 2), [2, 4, 6]);
  near(a, [1, 2, 3]);
  assert.equal(dot(a, [1, 0, 1]), 4);
  near(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(len([3, 4, 0]), 5);
  assert.equal(dist([1, 1, 1], [1, 4, 5]), 5);
  near(lerp([0, 0, 0], [2, 4, 6], 0.5), [1, 2, 3]);
  near(clampLen([3, 4, 0], 1), [0.6, 0.8, 0]);
  near(clampLen([0.3, 0.4, 0], 1), [0.3, 0.4, 0]);
});
test("rotateFromTo maps from onto to", () => near(rotateFromTo([1, 0, 0], [1, 0, 0], [0, 1, 0]), [0, 1, 0]));
test("rotateFromTo keeps a perpendicular vector perpendicular", () =>
  near(rotateFromTo([0, 0, 1], [1, 0, 0], [0, 1, 0]), [0, 0, 1]));
test("rotateFromTo with opposite vectors gives a valid half turn", () => {
  const r = rotateFromTo([0, 0, 1], [1, 0, 0], [-1, 0, 0]);
  assert.ok(Math.abs(len(r) - 1) < 1e-9 && Math.abs(dot(r, [1, 0, 0])) < 1e-9 && !r.some(Number.isNaN));
  near(rotateFromTo([1, 0, 0], [1, 0, 0], [-1, 0, 0]), [-1, 0, 0]);
});
test("rotateAxis turns a quarter about y", () => near(rotateAxis([1, 0, 0], [0, 1, 0], Math.PI / 2), [0, 0, -1]));
test("projectOnPlane removes the normal part", () => near(projectOnPlane([1, 2, 3], [0, 1, 0]), [1, 0, 3]));
test("norm of a zero vector is zero, not NaN", () => near(norm([0, 0, 0]), [0, 0, 0]));
