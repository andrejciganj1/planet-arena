import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld, addPlayer } from "../src/sim/world.js";
import { fire, explode, stepProjectiles } from "../src/sim/weapons.js";
import { seenCentre, placeRec } from "../src/sim/lag.js";
import { standOn, hitCentre } from "../src/sim/entity.js";
import { add, sub, scale, dist, norm, len, dot } from "../src/sim/vec.js";

const { TICK, PLAYER, NET, ROCKET, COLOURS } = tuning;

// Online world without pads; a (shooter) and b (target, tough) in open space, b moving 10 m/s along z.
function setup() {
  const w = { ...createWorld(tuning, { solo: false }), pads: [] };
  const a = addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  const b = addPlayer(w, "b", { name: "B", colour: COLOURS[2] });
  Object.assign(a, { pos: [0, 150, 0], groundId: null, vel: [0, 0, 0], airTime: 0 });
  Object.assign(b, { pos: [60, 150, 0], groundId: null, vel: [0, 0, 10], airTime: 0, health: 1e9 });
  for (let i = 0; i < 40; i++) {
    // Hold both in free flight; gravity here is too weak to matter over 40 ticks but b keeps its speed.
    stepWorld(w, {}, TICK);
    a.vel = [0, 0, 0];
    b.vel = [0, 0, 10];
    a.airTime = b.airTime = 0;
  }
  return { w, a, b };
}
const hits = (w, id) => w.events.filter((x) => x.type === "hit" && x.id === id);
// Points a's view along +x/up at `target`.
function aimAt(a, target) {
  const eye = add(a.pos, scale(a.up, PLAYER.eye)), d = norm(sub(target, eye));
  const up = dot(d, a.up);
  a.forward = norm(sub(d, scale(a.up, up)));
  a.pitch = Math.asin(up);
}

test("a railgun shot where the shooter saw the target hits with the shooter's lag, and misses without it", () => {
  const { w, a, b } = setup();
  a.weapon = "railgun";
  a.weapons.push("railgun");
  a.ammo.railgun = 5;
  aimAt(a, seenCentre(w, b, 0.1));
  w.events.length = 0;
  assert.ok(fire(w, a, 0.1));
  assert.equal(hits(w, "b").length, 1);
  a.cooldown = 0;
  w.events.length = 0;
  assert.ok(fire(w, a, 0));
  assert.equal(hits(w, "b").length, 0, "b has moved 1 m since");
});

test("a bullet passing through where the target was seen hits; without lag the same path misses", () => {
  for (const [lag, n] of [[0.1, 1], [0, 0]]) {
    const { w, b } = setup();
    const P = seenCentre(w, b, 0.1);
    w.projectiles.push({ kind: "pistol", owner: "a", lag, age: 1, pos: sub(P, [2, 0, 0]), vel: [120, 0, 0] });
    w.events.length = 0;
    stepProjectiles(w, TICK);
    stepProjectiles(w, TICK);
    assert.equal(hits(w, "b").length, n);
  }
});

test("a target standing on a moving planet is rewound relative to the planet", () => {
  const { w, b } = setup();
  const mid = w.system.byId.mid;
  b.pos = add(w.poses.mid.pos, scale([0, 1, 0], mid.radius));
  b.up = [0, 1, 0];
  standOn(b, "mid");
  for (let i = 0; i < 30; i++) stepWorld(w, {}, TICK);
  const at = w.t - 0.2;
  const rec = w.history.find((h) => Math.abs(h.t - at) < TICK / 2);
  const old = rec.ents.b;
  const expected = add(add(w.poses.mid.pos, old.rel), scale(old.up, PLAYER.radius));
  const got = seenCentre(w, b, w.t - rec.t);
  assert.ok(dist(got, expected) < 1e-9);
  // The planet moved, so the old world position is far from the rewound one; riding it, b is where it is now.
  assert.ok(dist(old.pos, b.pos) > 0.5, `moved ${dist(old.pos, b.pos)}`);
  assert.ok(dist(got, hitCentre(b)) < 1e-6);
});

test("a rocket under the seen feet throws the target as hard as the shooter saw", () => {
  const push = (lag) => {
    const { w, b } = setup();
    const h = w.history.find((x) => Math.abs(x.t - (w.t - 0.1)) < TICK / 2);
    const feet = placeRec(h.ents.b, w.poses);
    const before = [...b.vel];
    explode(w, feet, "a", lag);
    return len(sub(b.vel, before));
  };
  const seen = push(0.1), now = push(0);
  assert.ok(seen >= 0.9 * ROCKET.knockback * (1 - PLAYER.radius / ROCKET.splash), `seen ${seen}`);
  assert.ok(now < seen, `now ${now} seen ${seen}`);
});

test("lag is capped at NET.maxLag", () => {
  const { w, b } = setup();
  assert.deepEqual(seenCentre(w, b, 5), seenCentre(w, b, NET.maxLag));
  assert.notDeepEqual(seenCentre(w, b, NET.maxLag), hitCentre(b));
});

test("hit events say who hit and from where", () => {
  const { w, a, b } = setup();
  a.weapon = "railgun";
  a.weapons.push("railgun");
  a.ammo.railgun = 5;
  aimAt(a, hitCentre(b));
  w.events.length = 0;
  fire(w, a, 0);
  const rail = hits(w, "b")[0];
  assert.equal(rail.by, "a");
  assert.deepEqual(rail.from, add(a.pos, scale(a.up, PLAYER.eye)));
  assert.equal(rail.damage, tuning.WEAPONS.railgun.damage);

  w.events.length = 0;
  const blast = add(hitCentre(b), [1, 0, 0]);
  explode(w, blast, "a", 0);
  const e = hits(w, "b")[0];
  assert.equal(e.by, "a");
  assert.deepEqual(e.from, blast);

  w.events.length = 0;
  w.projectiles.push({ kind: "pistol", owner: "a", lag: 0, age: 1, from: [1, 2, 3], pos: sub(hitCentre(b), [1, 0, 0]), vel: [120, 0, 0] });
  stepProjectiles(w, TICK);
  assert.deepEqual(hits(w, "b")[0].from, [1, 2, 3]);
});

test("in a cosmetic world nobody is hurt, and a blast pushes only you", () => {
  const { w, a, b } = setup();
  w.cosmetic = true;
  w.selfId = "a";
  const pushes = [];
  w.onSelfPush = (dv) => pushes.push(dv);
  Object.assign(b, { pos: add(a.pos, [1, 0, 0]) });
  const va = [...a.vel], vb = [...b.vel], ha = a.health, hb = b.health;
  w.events.length = 0;
  explode(w, add(hitCentre(a), [0, 0.5, 0]), "a", 0);
  assert.equal(a.health, ha);
  assert.equal(b.health, hb);
  assert.deepEqual(b.vel, vb);
  assert.equal(pushes.length, 1);
  assert.deepEqual(a.vel, add(va, pushes[0]));
  assert.ok(len(pushes[0]) > 0);
  assert.equal(hits(w, "a").length + hits(w, "b").length, 0);

  // A pellet that hits b pushes nobody; the projectile still stops.
  w.projectiles.push({ kind: "shotgun", owner: "a", lag: 0, age: 1, push: 5, pos: sub(hitCentre(b), [1, 0, 0]), vel: [120, 0, 0] });
  stepProjectiles(w, TICK);
  assert.deepEqual(b.vel, vb);
  assert.equal(w.projectiles.length, 0);
});
