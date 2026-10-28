import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld, addPlayer, removePlayer, creditOf } from "../src/sim/world.js";
import { explode } from "../src/sim/weapons.js";
import { hitCentre, standOn } from "../src/sim/entity.js";
import { add, sub, scale, norm, dist } from "../src/sim/vec.js";

const { TICK, PLAYER, COLOURS, SPAWN_BODIES } = tuning;

// An online world without pads, so no blast or spawn can meet one by chance.
const online = () => ({ ...createWorld(tuning, { solo: false }), pads: [] });
const two = (w) => [
  addPlayer(w, "a", { name: "A", colour: COLOURS[1] }),
  addPlayer(w, "b", { name: "B", colour: COLOURS[2] }),
];
const run = (w, secs, each = null) => {
  for (let i = 0; i < Math.round(secs / TICK); i++) {
    if (each) each();
    stepWorld(w, {}, TICK);
  }
};
// e in open space, far from every body, at rest in world terms.
function float(w, e, pos, vel = [0, 0, 0]) {
  Object.assign(e, { pos, vel, groundId: null, airTime: 0, groundTime: 0 });
}
const FAR = [0, 300, 0]; // above the sun's pole: open space, in range, gravity weak
// e on the surface of a body at direction u, at rest.
function stand(w, e, bodyId, u = [0, 1, 0]) {
  const b = w.system.byId[bodyId];
  Object.assign(e, { pos: add(w.poses[bodyId].pos, scale(u, b.radius)), up: u, groundTime: 0, airTime: 0 });
  standOn(e, bodyId);
}
const intoSun = (w, e) => {
  e.pos = add(w.poses.sun.pos, [0, 20, 0]);
  e.groundId = null;
  e.vel = [0, 0, 0];
};
const deaths = (w) => w.events.filter((x) => x.type === "death");
const lastDeath = (w) => deaths(w).at(-1);

test("an online world starts empty; one player gets the dummy, a second sends it away, it comes back when one is left", () => {
  const w = online();
  assert.deepEqual(Object.keys(w.entities), []);
  assert.equal(w.noCues, true);
  addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  assert.ok(w.entities.dummy);
  addPlayer(w, "b", { name: "B", colour: COLOURS[2] });
  assert.equal(w.entities.dummy, undefined);
  removePlayer(w, "b");
  assert.ok(w.entities.dummy);
  assert.deepEqual(w.scores, { a: { kills: 0, deaths: 0 } });
  assert.deepEqual(w.players, { a: { name: "A", colour: COLOURS[1] } });
});

test("removePlayer can keep the score for a reconnect, and addPlayer then restores it", () => {
  const w = online();
  addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  w.scores.a = { kills: 3, deaths: 2 };
  removePlayer(w, "a", { keepScore: true });
  assert.equal(w.entities.a, undefined);
  assert.equal(w.players.a, undefined);
  assert.deepEqual(w.scores.a, { kills: 3, deaths: 2 });
  addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  assert.deepEqual(w.scores.a, { kills: 3, deaths: 2 });
});

test("online players spawn only on the central planets, away from each other", () => {
  const w = online();
  const ids = ["a", "b", "c", "d", "e"];
  for (const [i, id] of ids.entries()) addPlayer(w, id, { name: id, colour: COLOURS[i] });
  const used = new Set();
  for (let n = 0; n < 40; n++) {
    const id = ids[n % ids.length], e = w.entities[id];
    e.health = 0;
    let respawned = false;
    for (let i = 0; i < 600 && !respawned; i++) {
      stepWorld(w, {}, TICK);
      respawned = w.events.some((x) => x.type === "respawn" && x.id === id);
      w.events = [];
    }
    assert.ok(respawned);
    assert.ok(SPAWN_BODIES.includes(e.groundId), `spawned on ${e.groundId}`);
    used.add(e.groundId);
    for (const o of Object.values(w.entities)) {
      if (o !== e && o.alive) assert.ok(dist(o.pos, e.pos) >= PLAYER.spawnFromOther, `${dist(o.pos, e.pos)} m from ${o.id}`);
    }
  }
  assert.equal(used.size, SPAWN_BODIES.length);
});

test("a knock into the sun is the hitter's kill, even after a long fall", () => {
  const w = online();
  const [a, b] = two(w);
  float(w, a, [0, 300, 40]);
  float(w, b, FAR);
  explode(w, add(hitCentre(b), [1, 0, 0]), "a");
  run(w, 15, () => float(w, b, b.pos, b.vel) || (b.groundId = null));
  intoSun(w, b);
  run(w, TICK);
  assert.deepEqual({ id: lastDeath(w).id, cause: lastDeath(w).cause, by: lastDeath(w).by }, { id: "b", cause: "sun", by: "a" });
  assert.equal(w.scores.a.kills, 1);
  assert.equal(w.scores.b.deaths, 1);
});

test("standing for a second after the hit clears the credit", () => {
  const w = online();
  const [a, b] = two(w);
  float(w, a, [0, 300, 40]);
  float(w, b, FAR);
  explode(w, add(hitCentre(b), [1, 0, 0]), "a");
  stand(w, b, "mid");
  run(w, 1.1);
  assert.equal(b.lastHitBy, null);
  intoSun(w, b);
  run(w, TICK);
  assert.equal(lastDeath(w).by, null);
  assert.equal(w.scores.a.kills, 0);
  assert.equal(w.scores.b.deaths, 1);
});

test("hit while standing, dead within the second: still the hitter's kill", () => {
  const w = online();
  const [a, b] = two(w);
  float(w, a, [0, 300, 40]);
  stand(w, b, "mid");
  run(w, 5.1);
  assert.ok(b.groundTime >= 5);
  explode(w, add(hitCentre(b), scale(b.up, 1)), "a");
  b.health = 100;
  run(w, 0.5);
  intoSun(w, b);
  run(w, TICK);
  assert.equal(lastDeath(w).by, "a");
  assert.equal(w.scores.a.kills, 1);
});

test("your own rocket: a death for you, a kill for nobody, no point lost", () => {
  const w = online();
  const [a, b] = two(w);
  float(w, a, [0, 300, 40]);
  float(w, b, FAR);
  b.health = 10;
  explode(w, hitCentre(b), "b");
  run(w, TICK);
  assert.equal(lastDeath(w).cause, "damage");
  assert.equal(lastDeath(w).by, null);
  assert.deepEqual(w.scores.b, { kills: 0, deaths: 1 });
  assert.deepEqual(w.scores.a, { kills: 0, deaths: 0 });
});

test("dummy kills don't count", () => {
  const w = online();
  const a = addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  float(w, a, [0, 300, 40]);
  const d = w.entities.dummy;
  float(w, d, FAR);
  explode(w, add(hitCentre(d), [1, 0, 0]), "a");
  intoSun(w, d);
  run(w, TICK);
  assert.equal(lastDeath(w).id, "dummy");
  assert.equal(lastDeath(w).by, "a");
  assert.deepEqual(w.scores, { a: { kills: 0, deaths: 0 } });
});

test("credit to a player who has left goes to nobody", () => {
  const w = online();
  const [a, b] = two(w);
  float(w, a, [0, 300, 40]);
  float(w, b, FAR);
  explode(w, add(hitCentre(b), [1, 0, 0]), "a");
  assert.equal(creditOf(w, b), "a");
  removePlayer(w, "a");
  assert.equal(creditOf(w, b), null);
  intoSun(w, b);
  run(w, TICK);
  assert.equal(lastDeath(w).by, null);
  assert.equal("a" in w.scores, false);
});

test("sun and damage deaths leave a blast where they happened; the void doesn't", () => {
  const w = online();
  const [a, b] = two(w);
  float(w, a, [0, 300, 40]);
  float(w, b, FAR);
  intoSun(w, b);
  w.explosions = [];
  run(w, TICK);
  assert.equal(lastDeath(w).cause, "sun");
  assert.deepEqual(lastDeath(w).pos, hitCentre(b));
  assert.deepEqual(w.explosions.map((x) => x.pos), [lastDeath(w).pos]);

  float(w, a, [0, 300, 40]);
  a.health = 0;
  w.explosions = [];
  run(w, TICK);
  assert.equal(lastDeath(w).cause, "damage");
  assert.equal(w.explosions.length, 1);

  const v = online();
  const [c] = two(v);
  float(v, c, [0, 0, tuning.VOID_RADIUS + 10]);
  v.explosions = [];
  run(v, TICK);
  assert.equal(lastDeath(v).cause, "void");
  assert.equal(v.explosions.length, 0);
});

test("the solo world: the player starts and respawns on PLAYER_BODY, with scores for 'player'", () => {
  const w = createWorld(tuning);
  assert.equal(w.solo, true);
  assert.equal(w.entities.player.groundId, tuning.PLAYER_BODY);
  assert.deepEqual(w.players, { player: { name: "You", colour: COLOURS[0] } });
  assert.deepEqual(w.scores, { player: { kills: 0, deaths: 0 } });
  assert.equal(COLOURS.length, 8);
  assert.equal(new Set(COLOURS).size, 8);
  w.entities.player.health = 0;
  run(w, PLAYER.respawn + 0.2);
  assert.equal(w.entities.player.alive, true);
  assert.equal(w.entities.player.groundId, tuning.PLAYER_BODY);
  assert.deepEqual(w.scores.player, { kills: 0, deaths: 1 });
});
