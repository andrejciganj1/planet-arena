import test from "node:test";
import assert from "node:assert/strict";
import { scoreRows, feedText, arcAngle } from "../src/client/hud.js";

test("scoreRows: most kills first, fewer deaths breaks ties", () => {
  const rows = scoreRows({
    a: { name: "Zed", kills: 2, deaths: 1 },
    b: { name: "Ana", kills: 3, deaths: 5 },
    c: { name: "Cy", kills: 2, deaths: 0 },
    d: { name: "Bo", kills: 2, deaths: 1 },
  });
  assert.deepEqual(rows.map((r) => r.id), ["b", "c", "d", "a"]); // 3 kills; 2 kills with 0 deaths; then name
  assert.deepEqual(rows[0], { id: "b", name: "Ana", kills: 3, deaths: 5 });
});

test("feedText names killer and victim with a mark per cause", () => {
  const players = { a: { name: "Ana" }, b: { name: "Ben" } };
  const death = (cause, by) => ({ type: "death", id: "b", cause, by, pos: [0, 0, 0] });
  assert.equal(feedText(death("sun", "a"), players), "Ana ☀ Ben");
  assert.equal(feedText(death("damage", "a"), players), "Ana ✹ Ben");
  assert.equal(feedText(death("void", "a"), players), "Ana ⋯ Ben");
  assert.equal(feedText(death("sun", null), players), "Ben");
  assert.equal(feedText({ ...death("damage", null), id: "dummy" }, players), "Dummy");
});

test("arcAngle points the arc at the shooter: right is +PI/2, behind-left is near -PI/2 .. -PI", () => {
  const cam = { pos: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
  const at = (x, y, z) => arcAngle(cam, [x, y, z]);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  close(at(0, 5, -1), 0); // above and ahead: straight up on screen
  close(at(5, 0, -1), Math.PI / 2); // to the right
  close(at(0, -5, -1), Math.PI); // below
  close(at(-5, 0, -1), -Math.PI / 2);
  const bl = at(-3, -1, 8); // behind and to the left, a little below
  assert.ok(bl < -Math.PI / 2 && bl > -Math.PI, `${bl}`);
  const dead = at(0, 0, 9); // exactly behind: still some side, the bottom
  close(Math.abs(dead), Math.PI);
});
