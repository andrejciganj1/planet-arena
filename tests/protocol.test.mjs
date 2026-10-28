import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld, addPlayer } from "../src/sim/world.js";
import { createEntity, hitCentre, NO_INPUT } from "../src/sim/entity.js";
import { add } from "../src/sim/vec.js";
import { fire, explode } from "../src/sim/weapons.js";
import { PROTOCOL, cleanInput, cleanName, entityState, applyEntity, snapshot } from "../src/net/protocol.js";

const { TICK, COLOURS, NET } = tuning;
const online = () => ({ ...createWorld(tuning, { solo: false }), pads: [] });

test("cleanInput keeps good input and repairs or rejects the rest", () => {
  assert.equal(PROTOCOL, 2);
  const good = { ...NO_INPUT, move: [0.5, -1], jump: true, fire: true, weapon: "rocket", yawDelta: 0.1, pitchDelta: -0.2, tick: 5, view: 3 };
  assert.deepEqual(cleanInput(good), good);
  const bad = cleanInput({ tick: 5, move: [NaN, 9], yawDelta: Infinity, pitchDelta: "1", fire: "yes", weapon: "bfg" });
  assert.deepEqual(bad.move, [0, 1]);
  assert.equal(bad.yawDelta, 0);
  assert.equal(bad.pitchDelta, 0);
  assert.equal(bad.fire, false);
  assert.equal(bad.weapon, null);
  assert.equal(bad.view, 5);
  assert.equal(cleanInput({ tick: 5, view: 9 }).view, 5);
  assert.equal(cleanInput({ tick: 5, yawDelta: 99 }).yawDelta, Math.PI);
  assert.deepEqual(cleanInput({ tick: 5, move: "ab" }).move, [0, 0]);
  for (const t of [1e300, -5, 2 ** 60]) assert.equal(cleanInput({ tick: t }), null);
  for (const v of [-1e300, 0.5, 6, -1, "3"]) assert.equal(cleanInput({ tick: 5, view: v }).view, 5);
  assert.equal(cleanInput({ tick: 5, view: 0 }).view, 0);
  for (const raw of [null, undefined, "x", 3, {}, { tick: 1.5 }, { tick: NaN }, { tick: "1" }]) assert.equal(cleanInput(raw), null);
});

test("cleanName trims, cuts and numbers duplicates", () => {
  assert.equal(cleanName("  Ana  ", []), "Ana");
  assert.equal(cleanName("a   b", []), "a b");
  assert.equal(cleanName("", []), "Player");
  assert.equal(cleanName(JSON.parse('{"toString":1}'), []), "Player");
  assert.equal(cleanName(JSON.parse('[{"toString":1}]'), []), "Player");
  assert.equal(cleanName(JSON.parse("12"), []), "12");
  assert.equal(cleanName(undefined, []), "Player");
  assert.equal(cleanName("a\u0000b", []), "ab");
  assert.equal(cleanName("x".repeat(40), []), "x".repeat(16));
  assert.equal(cleanName("ana", ["Ana"]), "ana 2");
  assert.equal(cleanName("Ana", ["Ana", "Ana 2"]), "Ana 3");
  assert.ok(cleanName("x".repeat(16), ["x".repeat(16)]).length <= NET.nameMax);
});

function same(a, b) {
  const { prev, ...rest } = b;
  assert.deepEqual(a, rest);
}

test("an entity survives a JSON round trip exactly, -Infinity included", () => {
  const w = online();
  const [a, b] = [addPlayer(w, "a", { name: "A", colour: COLOURS[1] }), addPlayer(w, "b", { name: "B", colour: COLOURS[2] })];
  const fresh = createEntity("f", "player", [1, 2, 3], [0, 1, 0]);
  assert.equal(fresh.lastHitAt, -Infinity);
  const ship = (e) => JSON.parse(JSON.stringify(entityState(e)));
  const copy = createEntity("z", "player", [0, 0, 0], [0, 1, 0]);
  applyEntity(copy, ship(fresh));
  same(copy, fresh);
  for (let i = 0; i < 200; i++) stepWorld(w, { a: { ...NO_INPUT, move: [0, 1], yawDelta: 0.01 } }, TICK);
  explode(w, add(hitCentre(a), [1, 0, 0]), "b");
  assert.ok(Number.isFinite(a.lastHitAt));
  a.hook = { body: "tiny", offset: [1, 2, 3], len: 4 };
  const got = createEntity("z", "player", [0, 0, 0], [0, 1, 0]);
  got.prev = { junk: true };
  applyEntity(got, ship(a));
  assert.equal(got.prev, undefined);
  same(got, a);
  assert.ok(!("prev" in entityState(a)));
  const c = createEntity("z", "player", [0, 0, 0], [0, 1, 0]);
  applyEntity(c, ship(b));
  same(c, b);
});

test("a snapshot has every entity, shot, pickup and player, and survives JSON", () => {
  const w = online();
  const [a] = [addPlayer(w, "a", { name: "Ana", colour: COLOURS[1] }), addPlayer(w, "b", { name: "Bo", colour: COLOURS[2] })];
  a.weapons.push("rocket"); a.ammo.rocket = 3; a.weapon = "rocket";
  fire(w, a, { ...NO_INPUT, fire: true, lag: 0 });
  w.scores.a.kills = 2;
  const id = tuning.PICKUPS[0].id;
  w.pickups[id] = { readyAt: 12.5 };
  w.beams.push({ from: [0, 0, 0], to: [1, 1, 1], age: 0, owner: "a", id: 7 });
  const snap = snapshot(w, { tick: w.tick, ack: 9, slack: 3, events: [{ type: "boom" }] });
  const back = JSON.parse(JSON.stringify(snap));
  assert.deepEqual(back, snap);
  assert.equal(snap.type, "snap");
  assert.equal(snap.tick, w.tick);
  assert.equal(snap.t, w.t);
  assert.equal(snap.ack, 9);
  assert.equal(snap.slack, 3);
  assert.equal(snap.entities.length, 2);
  assert.ok(w.projectiles.length > 0);
  assert.equal(snap.shots.length, w.projectiles.length);
  assert.deepEqual(Object.keys(snap.shots[0]).sort(), ["id", "kind", "owner", "pos", "vel"]);
  assert.deepEqual(snap.pickups, { [id]: 12.5 });
  assert.deepEqual(snap.players.a, { name: "Ana", colour: COLOURS[1], kills: 2, deaths: 0 });
  assert.equal(Object.keys(snap.players).length, 2);
  assert.deepEqual(snap.beams, w.beams);
  assert.deepEqual(snap.events, [{ type: "boom" }]);
});
