import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld, advance, spawnPoint } from "../src/sim/world.js";
import { padPos } from "../src/sim/pads.js";
import { NO_INPUT, hitCentre } from "../src/sim/entity.js";
import { sphereContacts, surfaceInfo } from "../src/sim/collide.js";
import { add, dist } from "../src/sim/vec.js";
import { skipTo } from "./helpers.mjs";

const { TICK, MAX_TICKS, VOID_RADIUS, DUMMY, PLAYER } = tuning;
const deaths = (w) => w.events.filter((e) => e.type === "death");

test("a new world has the player on its body and the dummy on the tiny planet", () => {
  const w = createWorld(tuning);
  const on = (e, id) => Math.abs(surfaceInfo(w.system.byId[id], w.poses[id], e.pos).dist) < 1e-6 && e.groundId === id;
  assert.ok(on(w.entities.player, tuning.PLAYER_BODY));
  assert.ok(on(w.entities.dummy, DUMMY.body));
});

test("an entity placed in the sun dies with cause sun", () => {
  const w = createWorld(tuning);
  const d = w.entities.dummy;
  d.groundId = null;
  d.pos = add(w.poses.sun.pos, [0, w.system.byId.sun.radius - 1, 0]);
  d.up = [0, 1, 0];
  stepWorld(w, {}, TICK);
  assert.deepEqual(deaths(w), [{ type: "death", id: "dummy", cause: "sun" }]);
  assert.equal(d.alive, false);
});

test("an entity beyond the void radius dies with cause void", () => {
  const w = createWorld(tuning);
  const p = w.entities.player;
  p.groundId = null;
  p.pos = [VOID_RADIUS + 5, 0, 0];
  stepWorld(w, {}, TICK);
  assert.deepEqual(deaths(w), [{ type: "death", id: "player", cause: "void" }]);
});

test("the dummy respawns on the tiny planet 3 s after dying", () => {
  const w = createWorld(tuning);
  const d = w.entities.dummy;
  d.health = 0;
  stepWorld(w, {}, TICK);
  assert.deepEqual(deaths(w), [{ type: "death", id: "dummy", cause: "damage" }]);
  const diedAt = w.t;
  while (w.t < diedAt + DUMMY.respawn - 2 * TICK) stepWorld(w, {}, TICK);
  assert.equal(d.alive, false);
  for (let i = 0; i < 3; i++) stepWorld(w, {}, TICK);
  assert.equal(d.alive, true);
  assert.ok(w.events.some((e) => e.type === "respawn" && e.id === "dummy"));
  assert.equal(d.groundId, DUMMY.body);
  assert.ok(Math.abs(surfaceInfo(w.system.byId.tiny, w.poses.tiny, d.pos).dist) < 0.05);
  assert.equal(d.health, DUMMY.health);
});

test("the dead are not stepped", () => {
  const w = createWorld(tuning);
  const d = w.entities.dummy;
  d.health = 0;
  stepWorld(w, {}, TICK);
  const at = [...d.pos];
  stepWorld(w, {}, TICK);
  assert.deepEqual(d.pos, at);
});

test("respawn points are on the surface, clear of pads, not inside a body", () => {
  for (const t of [0, 77, 250]) {
    const w = createWorld(tuning);
    skipTo(w, t);
    w.entities.dummy.pos = spawnPoint(w, "tiny", "dummy").pos;
    for (const b of tuning.BODIES.filter((b) => b.kind !== "sun")) {
      for (let k = 0; k < 6; k++) {
        const { pos, up } = spawnPoint(w, b.id, "player");
        const s = surfaceInfo(b, w.poses[b.id], pos);
        assert.ok(Math.abs(s.dist) < 1e-6, `${b.id} on surface`);
        for (const pad of w.pads) assert.ok(dist(pos, padPos(w, pad, w.poses)) >= PLAYER.spawnFromPad, `${b.id} near ${pad.id}`);
        const c = sphereContacts(w.system, w.poses, add(pos, up.map((x) => x * PLAYER.radius)), PLAYER.radius);
        assert.ok(c.every((c) => c.depth < 1e-6), `${b.id} inside ${c.map((c) => c.id)}`);
        if (b.id === tuning.PLAYER_BODY) assert.ok(dist(pos, w.entities.dummy.pos) >= PLAYER.spawnFromOther);
      }
    }
  }
  // Next to the player: the dummy is on the tiny planet, so move the player there.
  const w = createWorld(tuning);
  w.entities.dummy.pos = spawnPoint(w, "mid", "dummy").pos;
  const { pos } = spawnPoint(w, "mid", "player");
  assert.ok(dist(pos, w.entities.dummy.pos) >= PLAYER.spawnFromOther);
});

test("the same world gives the same point", () => {
  assert.deepEqual(spawnPoint(createWorld(tuning), "mid", "player"), spawnPoint(createWorld(tuning), "mid", "player"));
});

test("advance runs at most MAX_TICKS ticks for a 10 s gap", () => {
  const w = createWorld(tuning);
  const acc = advance(w, 0, 10, {});
  assert.equal(w.tick, MAX_TICKS);
  assert.ok(acc >= 0 && acc < TICK);
});

test("advance carries the remainder", () => {
  const w = createWorld(tuning);
  let acc = advance(w, 0, 2.5 * TICK, {});
  assert.equal(w.tick, 2);
  acc = advance(w, acc, 0.5 * TICK, {});
  assert.equal(w.tick, 3);
});

test("advance applies look deltas and jumps once, not once per tick", () => {
  const w = createWorld(tuning);
  const p = w.entities.player;
  advance(w, 0, 3 * TICK + 1e-6, { player: { ...NO_INPUT, pitchDelta: 0.1 } });
  assert.ok(Math.abs(p.pitch - 0.1) < 1e-9);
});

test("touching the sun's surface is enough to die", () => {
  const w = createWorld(tuning);
  const d = w.entities.dummy;
  d.groundId = null;
  d.pos = add(w.poses.sun.pos, [0, w.system.byId.sun.radius - 0.05, 0]);
  d.up = [0, 1, 0];
  stepWorld(w, {}, TICK);
  assert.equal(deaths(w)[0]?.cause, "sun");
});

test("each tick keeps the previous position and up for drawing between ticks; a respawn has none", () => {
  const w = createWorld(tuning);
  const p = w.entities.player;
  stepWorld(w, {}, TICK);
  const pos = [...p.pos], up = [...p.up];
  stepWorld(w, { player: { ...NO_INPUT, move: [0, 1] } }, TICK);
  assert.deepEqual(p.prev.pos, pos);
  assert.deepEqual(p.prev.up, up);
  const d = w.entities.dummy;
  d.health = 0;
  stepWorld(w, {}, TICK);
  while (!d.alive) stepWorld(w, {}, TICK);
  assert.equal(d.prev, null);
});

test("the dummy never respawns next to the player, even on the tiny planet", () => {
  for (let k = 0; k < 6; k++) {
    for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0.6, 0.8, 0]]) {
      const w = createWorld(tuning);
      w.spawns = k;
      const tiny = w.system.byId.tiny, p = w.entities.player;
      p.pos = add(w.poses.tiny.pos, u.map((x) => x * tiny.radius));
      const { pos } = spawnPoint(w, "tiny", "dummy");
      assert.ok(dist(pos, p.pos) >= 8, `k=${k} u=${u}: ${dist(pos, p.pos).toFixed(2)} m`);
    }
  }
});

test("an entity adrift too long is lost to the void", () => {
  const w = createWorld(tuning);
  const d = w.entities.dummy;
  d.groundId = null;
  d.pos = [0, 300, 0]; // far above the plane, falling slowly
  d.vel = [0, 0, 0];
  let t = 0;
  while (d.alive && t < tuning.PLAYER.adrift + 1) stepWorld(w, {}, TICK), (t += TICK);
  assert.deepEqual(deaths(w), [{ type: "death", id: "dummy", cause: "void" }]);
  assert.ok(t >= tuning.PLAYER.adrift - 2 * TICK, `died after ${t}`);
});
