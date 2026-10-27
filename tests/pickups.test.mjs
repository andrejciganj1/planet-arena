import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld } from "../src/sim/world.js";
import { padPos } from "../src/sim/pads.js";
import { pickupPos, pickupReady } from "../src/sim/pickups.js";
import { createEntity, standOn } from "../src/sim/entity.js";
import { surfaceInfo } from "../src/sim/collide.js";
import { dist } from "../src/sim/vec.js";

const { TICK, PICKUP, PICKUPS, BOOST, PLAYER, WEAPONS, WEAPON_ORDER, BODIES } = tuning;

// A pad-free world with the dummy out of the way.
function world() {
  const w = { ...createWorld(tuning), pads: [] };
  w.entities.dummy.alive = false;
  w.entities.dummy.respawnAt = Infinity;
  return w;
}
const find = (pred) => PICKUPS.find(pred);
// Puts entity e's feet on pickup pk, standing.
function onto(w, e, pk) {
  const at = pickupPos(w, pk, w.poses);
  Object.assign(e, { ...createEntity(e.id, e.kind, at, pk.dir), weapons: e.weapons, ammo: e.ammo, weapon: e.weapon, health: e.health, fuel: e.fuel });
  standOn(e, pk.body);
}
const took = (w, pk) => w.events.some((ev) => ev.type === "pickup" && ev.pickupId === pk.id);

test("layout: every planet and the moon have at least two pickups; each weapon but the pistol can be found; the sniper rifle and railgun only on the hot planet or the moon", () => {
  for (const b of BODIES.filter((b) => b.kind === "planet" || b.kind === "moon")) {
    assert.ok(PICKUPS.filter((p) => p.body === b.id).length >= 2, b.id);
  }
  for (const wpn of WEAPON_ORDER.filter((x) => x !== "pistol")) {
    assert.ok(PICKUPS.some((p) => p.kind === "weapon" && p.weapon === wpn), wpn);
  }
  for (const p of PICKUPS.filter((p) => p.kind === "weapon" && (p.weapon === "sniper" || p.weapon === "railgun"))) {
    assert.ok(p.body === "hot" || p.body === "moon", `${p.id} on ${p.body}`);
  }
});

test("layout: pickups sit on the surface, at least 4 m from every pad and 3 m from each other", () => {
  const w = createWorld(tuning);
  for (const p of PICKUPS) {
    const at = pickupPos(w, p, w.poses);
    assert.ok(Math.abs(surfaceInfo(w.system.byId[p.body], w.poses[p.body], at).dist) < 1e-9, p.id);
    for (const pad of w.pads) assert.ok(dist(at, padPos(w, pad, w.poses)) >= 4, `${p.id} near ${pad.id}`);
    for (const q of PICKUPS) if (q !== p) assert.ok(dist(at, pickupPos(w, q, w.poses)) >= 3, `${p.id} near ${q.id}`);
  }
});

test("health heals 25 up to the maximum, and isn't taken at full health", () => {
  const w = world(), p = w.entities.player, pk = find((x) => x.kind === "health");
  p.health = 50;
  onto(w, p, pk);
  stepWorld(w, {}, TICK);
  assert.equal(p.health, 50 + PICKUP.health);
  assert.ok(took(w, pk) && !pickupReady(w, pk));
  const w2 = world(), p2 = w2.entities.player;
  p2.health = 90;
  onto(w2, p2, pk);
  stepWorld(w2, {}, TICK);
  assert.equal(p2.health, PLAYER.health);
  const w3 = world(), p3 = w3.entities.player;
  onto(w3, p3, pk);
  stepWorld(w3, {}, TICK);
  assert.ok(!took(w3, pk) && pickupReady(w3, pk), "left for someone who needs it");
});

test("a weapon pickup gives the weapon with 'pickup' ammo and puts it in hand; held and full, it stays", () => {
  const w = world(), p = w.entities.player, pk = find((x) => x.kind === "weapon" && x.weapon === "shotgun");
  onto(w, p, pk);
  stepWorld(w, {}, TICK);
  assert.ok(p.weapons.includes("shotgun"));
  assert.equal(p.ammo.shotgun, WEAPONS.shotgun.ammo.pickup);
  assert.equal(p.weapon, "shotgun");
  const w2 = world(), p2 = w2.entities.player;
  p2.weapons.push("shotgun");
  p2.ammo.shotgun = WEAPONS.shotgun.ammo.max;
  onto(w2, p2, pk);
  stepWorld(w2, {}, TICK);
  assert.ok(!took(w2, pk));
});

test("an ammo box adds 'box' ammo up to max, for a weapon you don't hold too", () => {
  const w = world(), p = w.entities.player, pk = find((x) => x.kind === "ammo" && x.weapon === "shotgun");
  onto(w, p, pk);
  stepWorld(w, {}, TICK);
  assert.equal(p.ammo.shotgun, WEAPONS.shotgun.ammo.box);
  assert.deepEqual(p.weapons, ["pistol"]);
  const w2 = world(), p2 = w2.entities.player;
  p2.ammo.shotgun = WEAPONS.shotgun.ammo.max - 2;
  onto(w2, p2, pk);
  stepWorld(w2, {}, TICK);
  assert.equal(p2.ammo.shotgun, WEAPONS.shotgun.ammo.max);
});

test("fuel fills to twice the tank; standing doesn't lower it; spent, it refills only to the usual tank", () => {
  const w = world(), p = w.entities.player, pk = find((x) => x.kind === "fuel");
  onto(w, p, pk);
  stepWorld(w, {}, TICK);
  assert.equal(p.fuel, BOOST.fuel * PICKUP.fuelMax);
  for (let i = 0; i < 2 / TICK; i++) stepWorld(w, {}, TICK);
  assert.equal(p.fuel, BOOST.fuel * PICKUP.fuelMax);
  p.fuel = BOOST.fuel - 1;
  w.pickups[pk.id].readyAt = Infinity; // keep this test off the pickup
  for (let i = 0; i < 5 / TICK; i++) stepWorld(w, {}, TICK);
  assert.equal(p.fuel, BOOST.fuel);
});

test("a taken pickup comes back after its respawn time, not before", () => {
  const w = world(), p = w.entities.player, pk = find((x) => x.kind === "health");
  p.health = 10;
  onto(w, p, pk);
  stepWorld(w, {}, TICK);
  assert.ok(!pickupReady(w, pk));
  p.health = PLAYER.health; // so it doesn't take the pack again the moment it is back
  const back = w.t + PICKUP.respawn.health;
  while (w.t < back - 0.5) stepWorld(w, {}, TICK);
  assert.ok(!pickupReady(w, pk));
  while (w.t < back + TICK) stepWorld(w, {}, TICK);
  assert.ok(pickupReady(w, pk));
});

test("the dummy never takes pickups", () => {
  const w = { ...createWorld(tuning), pads: [] }, d = w.entities.dummy, pk = find((x) => x.kind === "health");
  d.health = 10;
  onto(w, d, pk);
  stepWorld(w, {}, TICK);
  assert.ok(!took(w, pk) && pickupReady(w, pk));
  assert.equal(d.health, 10);
});
