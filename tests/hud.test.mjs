import test from "node:test";
import assert from "node:assert/strict";
import { scoreRows, feedText, arcAngle, since, expire } from "../src/client/hud.js";

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

test("since: seconds since a moment, or Infinity once the clock is before it, so nothing sticks", () => {
  assert.equal(since(2, 5), 3);
  assert.equal(since(5, 5), 0);
  assert.equal(since(3000, 4), Infinity); // a clock that went back
  assert.equal(since(-Infinity, 0), Infinity); // never happened
});

test("expire drops every line past its time, wherever it is in the list, also when the clock jumps back", () => {
  const lines = [{ at: 10 }, { at: 1 }, { at: 9 }];
  assert.deepEqual(expire(lines, 12, 4).map((l) => l.at), [1]);
  assert.deepEqual(lines.map((l) => l.at), [10, 9]);
  // The clock went back to 2: lines from "the future" are stale, not shown for minutes.
  const later = [{ at: 1 }, { at: 3000 }, { at: 3001 }];
  assert.deepEqual(expire(later, 2, 4).map((l) => l.at), [3000, 3001]);
  assert.deepEqual(later.map((l) => l.at), [1]);
});

test("the flare banner counts down the warning, then tells you to get out of the light", async () => {
  const { flareBanner } = await import("../src/client/look/flarepose.js");
  const { flareAt } = await import("../src/sim/flares.js");
  const f = flareAt(0);
  assert.deepEqual(flareBanner(f.warnAt + 1), { text: "SOLAR FLARE INCOMING", count: 4 });
  assert.deepEqual(flareBanner(f.warnAt + 4.5), { text: "SOLAR FLARE INCOMING", count: 1 });
  assert.deepEqual(flareBanner(f.burnAt + 1), { text: "SOLAR FLARE: GET OUT OF THE LIGHT", count: null });
  assert.equal(flareBanner(f.warnAt - 1), null);
  assert.equal(flareBanner(f.endAt + 1), null);
});

test("the sun readout gives whole metres and turns orange inside the flare's reach", async () => {
  const { sunReadout } = await import("../src/client/look/flarepose.js");
  const tuning = await import("../src/tuning.js");
  const { createWorld } = await import("../src/sim/world.js");
  const { createEntity } = await import("../src/sim/entity.js");
  const w = createWorld(tuning, { solo: false }), sun = w.poses.sun.pos, r = tuning.PLAYER.radius;
  // Feet r below the middle, along +y from the sun: the middle is `d` m out.
  const at = (d) => createEntity("x", "player", [sun[0], sun[1] + d - r, sun[2]], [0, 1, 0]);
  assert.deepEqual(sunReadout(w, at(46.4)), { text: "Sun 46 m", near: true });
  assert.deepEqual(sunReadout(w, at(149.6)), { text: "Sun 150 m", near: true });
  assert.deepEqual(sunReadout(w, at(151)), { text: "Sun 151 m", near: false });
});
