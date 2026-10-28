import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, stepWorld } from "../src/sim/world.js";
import { fire, explode } from "../src/sim/weapons.js";
import { createEntity, standOn, hitCentre, viewDir, NO_INPUT } from "../src/sim/entity.js";
import { surfaceInfo } from "../src/sim/collide.js";
import { add, sub, scale, norm, dist, dot, len, cross, projectOnPlane, anyPerpendicular } from "../src/sim/vec.js";
import { stepProjectiles } from "../src/sim/weapons.js";

const { TICK, ROCKET, PISTOL, PLAYER } = tuning;

// A world without pads, so a blast or a landing can't hit one by chance (pads have their own tests).
const padless = () => ({ ...createWorld(tuning), pads: [] });
// The dummy and the player moved to stand on chosen bodies at direction u.
function put(w, id, bodyId, u) {
  const b = w.system.byId[bodyId], e = w.entities[id];
  Object.assign(e, createEntity(e.id, e.kind, add(w.poses[bodyId].pos, scale(u, b.radius)), u));
  standOn(e, bodyId);
  return e;
}
const sunward = (w, id) => norm(sub(w.poses.sun.pos, w.poses[id].pos));
const run = (w, secs, inputs = {}, each = null) => {
  for (let i = 0; i < secs / TICK; i++) {
    stepWorld(w, typeof inputs === "function" ? inputs() : inputs, TICK);
    if (each && each()) return true;
  }
  return false;
};
// Hands e weapon w with n rounds and puts it in hand.
function arm(e, w, n = 15) {
  if (!e.weapons.includes(w)) e.weapons.push(w);
  e.ammo[w] = n;
  e.weapon = w;
}
// Keeps the far entity out of the way.
const park = (w, id) => put(w, id, "heavy", [0, -1, 0]);

test("a pistol bullet fired level on the mid planet falls with gravity", () => {
  const w = createWorld(tuning);
  park(w, "dummy");
  const p = put(w, "player", "mid", [0, 1, 0]);
  assert.equal(fire(w, p), true);
  const b = w.projectiles[0];
  const start = [...b.pos], v0 = [...b.vel], t0 = w.t;
  run(w, 0.1);
  const straight = add(start, scale(v0, w.t - t0));
  const drop = sub(b.pos, straight);
  assert.ok(dot(drop, [0, -1, 0]) > 0.02, `drop ${drop}`);
  assert.equal(b.kind, "pistol");
});

test("a rocket curves towards the planet it was fired across", () => {
  const w = createWorld(tuning);
  park(w, "dummy");
  const p = put(w, "player", "mid", [0, 1, 0]);
  arm(p, "rocket");
  fire(w, p);
  const r = w.projectiles[0];
  const start = [...r.pos], v0 = [...r.vel], t0 = w.t;
  run(w, 0.3);
  assert.equal(w.projectiles[0], r, "still flying");
  const straight = add(start, scale(v0, w.t - t0));
  assert.ok(dist(r.pos, w.poses.mid.pos) < dist(straight, w.poses.mid.pos) - 0.2);
});

test("a rocket that hits the ground explodes there", () => {
  const w = createWorld(tuning);
  park(w, "dummy");
  const p = put(w, "player", "mid", norm([1, 1, 0]));
  arm(p, "rocket");
  p.pitch = -Math.PI / 2;
  run(w, 0.1, { player: { ...NO_INPUT, fire: true } });
  const ex = w.events.find((e) => e.type === "explode");
  assert.ok(ex, "exploded");
  assert.ok(dist(ex.pos, p.pos) < 0.5 || dist(ex.pos, surfaceInfo(w.system.byId.mid, w.poses.mid, p.pos).point) < 0.5);
  assert.equal(w.projectiles.length, 0);
});

test("splash damage falls off with distance and stops at the radius", () => {
  for (const d of [0.5, 2, 3.5, ROCKET.splash + 0.1]) {
    const w = createWorld(tuning);
    const e = w.entities.dummy;
    const at = sub(hitCentre(e), scale(e.up, d));
    explode(w, at, "player");
    const want = d < ROCKET.splash ? ROCKET.damage * (1 - d / ROCKET.splash) : 0;
    assert.ok(Math.abs(tuning.DUMMY.health - e.health - want) < 1e-9, `d=${d}`);
    assert.equal(w.events.some((x) => x.type === "hit"), want > 0);
    if (want > 0) assert.equal(e.lastHitBy, "player");
  }
});

test("a rocket jump on the heavy planet lifts the player and lands them back", () => {
  const w = padless();
  park(w, "dummy");
  w.entities.dummy.pos = add(w.entities.dummy.pos, [0, 0, 0]);
  const p = put(w, "player", "heavy", norm([0, 1, 1]));
  arm(p, "rocket");
  p.pitch = -Math.PI / 2;
  let top = 0, left = false, shot = false;
  const once = () => (shot ? {} : ((shot = true), { player: { ...NO_INPUT, fire: true } }));
  const back = run(w, 10, once, () => {
    top = Math.max(top, surfaceInfo(w.system.byId.heavy, w.poses.heavy, p.pos).dist);
    if (!p.groundId) left = true;
    return left && p.groundId === "heavy";
  });
  assert.ok(top > 3, `top ${top}`);
  assert.ok(back && p.alive);
  assert.ok(p.health < PLAYER.health && p.health > 0);
});

// The strongest blast a real rocket delivers: bursting on the ground at the feet.
const blastUnder = (w, e, owner) => explode(w, e.pos, owner);

test("a rocket under the dummy on the tiny planet sends it into the sun", () => {
  for (const t of [0, 45, 90]) {
    const w = padless();
    run(w, t);
    put(w, "player", "mid", [0, 1, 0]);
    const d = put(w, "dummy", "tiny", sunward(w, "tiny"));
    blastUnder(w, d, "player");
    const died = run(w, 20, {}, () => w.events.some((e) => e.type === "death"));
    assert.ok(died, `t=${t}`);
    const { type, id, cause } = w.events.find((e) => e.type === "death");
    assert.deepEqual({ type, id, cause }, { type: "death", id: "dummy", cause: "sun" });
  }
});

test("the same blast on the heavy planet doesn't throw the dummy off", () => {
  const w = padless();
  const d = put(w, "dummy", "heavy", sunward(w, "heavy"));
  blastUnder(w, d, "player");
  assert.equal(d.groundId, null);
  const back = run(w, 5, {}, () => d.groundId === "heavy");
  assert.ok(back && d.alive);
});

test("thrown off the tiny planet, a full booster can bring you back", () => {
  for (const t of [0, 45, 90]) {
    const w = padless();
    run(w, t);
    park(w, "dummy");
    const p = put(w, "player", "tiny", sunward(w, "tiny"));
    blastUnder(w, p, "dummy");
    // Aim at the planet's centre and boost ahead.
    const aim = () => {
      const to = norm(sub(w.poses.tiny.pos, hitCentre(p)));
      const f = projectOnPlane(to, p.up);
      if (len(f) > 1e-6) p.forward = norm(f);
      p.pitch = Math.asin(Math.max(-1, Math.min(1, dot(to, p.up))));
      return { player: { ...NO_INPUT, boost: true, move: [0, 1] } };
    };
    const back = run(w, 20, aim, () => p.groundId === "tiny" || !p.alive);
    assert.ok(back && p.alive && p.groundId === "tiny", `t=${t}`);
  }
});

test("fire honours the cooldown, and the weapon input switches weapons", () => {
  const w = createWorld(tuning);
  const p = w.entities.player;
  assert.equal(fire(w, p), true);
  assert.equal(fire(w, p), false);
  run(w, PISTOL.cooldown + TICK);
  assert.equal(fire(w, p), true);
  arm(p, "rocket");
  p.weapon = "pistol";
  stepWorld(w, { player: { ...NO_INPUT, weapon: "rocket" } }, TICK);
  assert.equal(p.weapon, "rocket");
  run(w, ROCKET.cooldown);
  fire(w, p);
  assert.equal(w.projectiles.at(-1).kind, "rocket");
  // A projectile carries the shooter's velocity: on a moving planet, the planet's.
  const r = w.projectiles.at(-1);
  assert.ok(Math.abs(len(sub(r.vel, w.poses.mid.vel)) - ROCKET.speed) < 0.5);
});

test("you start with the pistol only, and a key for a weapon you don't hold does nothing", () => {
  const w = padless(), p = w.entities.player;
  assert.deepEqual(p.weapons, ["pistol"]);
  stepWorld(w, { player: { ...NO_INPUT, weapon: "rocket" } }, TICK);
  assert.equal(p.weapon, "pistol");
});

test("a held weapon spends one ammo per shot, and an empty one hands you the pistol", () => {
  const w = padless(), p = w.entities.player;
  arm(p, "rocket", 2);
  assert.equal(fire(w, p), true);
  assert.equal(p.ammo.rocket, 1);
  run(w, ROCKET.cooldown + TICK);
  assert.equal(fire(w, p), true);
  assert.equal(p.ammo.rocket, 0);
  assert.equal(p.weapon, "pistol");
  run(w, ROCKET.cooldown + TICK);
  assert.equal(fire(w, p), true);
  assert.equal(w.projectiles.at(-1).kind, "pistol");
});

test("the pistol never runs out", () => {
  const w = padless(), p = w.entities.player;
  for (let i = 0; i < 50; i++) {
    assert.equal(fire(w, p), true, `shot ${i}`);
    p.cooldown = 0;
  }
  assert.equal(p.ammo.pistol, undefined);
});

test("respawning gives the pistol only", () => {
  const w = padless(), p = w.entities.player;
  arm(p, "rocket");
  arm(p, "shotgun", 8);
  p.pos = add(w.poses.sun.pos, [0, w.system.byId.sun.radius - 1, 0]);
  p.groundId = null;
  run(w, PLAYER.respawn + 0.5);
  assert.ok(p.alive);
  assert.deepEqual(p.weapons, ["pistol"]);
  assert.deepEqual(p.ammo, {});
  assert.equal(p.weapon, "pistol");
});

// Shooter (player) and target (dummy) held still in open space, far above the planets' plane, the shooter
// looking straight at the target from `range` m. Returns the world and a step that keeps them in place.
function range(rangeM, weapon, opts = {}) {
  const w = padless(), p = w.entities.player, d = w.entities.dummy;
  const eye = [0, 150, 0], dir = [1, 0, 0], up = [0, 1, 0];
  const place = () => {
    Object.assign(p, { pos: sub(eye, scale(up, PLAYER.eye)), vel: [0, 0, 0], up, forward: dir, pitch: 0, groundId: null, airTime: 0 });
    Object.assign(d, { pos: sub(add(eye, scale(dir, rangeM)), scale(up, PLAYER.radius)), vel: [0, 0, 0], up, groundId: null, airTime: 0 });
  };
  place();
  d.health = opts.health ?? 1e9;
  if (weapon !== "pistol") arm(p, weapon, 1e6);
  return { w, p, d, eye, dir, place };
}
const damageTo = (w, id) => w.events.filter((e) => e.type === "hit" && e.id === id).reduce((a, e) => a + e.damage, 0);

test("the railgun hits instantly along a straight line", () => {
  const { w, p } = range(60, "railgun");
  stepWorld(w, { player: { ...NO_INPUT, fire: true } }, TICK);
  assert.equal(damageTo(w, "dummy"), tuning.WEAPONS.railgun.damage);
  // The shooter drifts and turns a hair during the tick, so the eye and view are taken after it.
  const eye = add(p.pos, scale(p.up, PLAYER.eye)), dir = viewDir(p);
  const beam = w.events.find((e) => e.type === "beam");
  assert.ok(beam && dist(beam.from, eye) < 1e-9, "beam from the eye");
  // The beam ends on the view line, at the target's hit sphere.
  const off = sub(beam.to, eye), along = dot(off, dir);
  // Off the line by nothing; along it, at the target's near side (its up turns a little in the tick).
  assert.ok(len(sub(off, scale(dir, along))) < 1e-6 && Math.abs(along - (60 - PLAYER.radius)) < 0.1, JSON.stringify(beam.to));
  assert.equal(w.projectiles.length, 0);
});

test("shotgun pellets push the target, not the shooter, and vanish beyond 35 m", () => {
  const shot = range(3, "shotgun"), twin = range(3, "shotgun");
  stepWorld(shot.w, { player: { ...NO_INPUT, fire: true } }, TICK);
  stepWorld(twin.w, {}, TICK);
  for (let i = 0; i < 10; i++) [shot, twin].forEach((x) => stepWorld(x.w, {}, TICK));
  assert.ok(damageTo(shot.w, "dummy") > 0);
  assert.ok(dot(sub(shot.d.vel, twin.d.vel), shot.dir) > 1, "target pushed along the shot");
  assert.ok(dist(shot.p.vel, twin.p.vel) < 1e-9, "shooter not pushed");
  const far = range(40, "shotgun");
  far.w.events.length = 0;
  for (let i = 0; i < 60; i++) {
    stepWorld(far.w, i === 0 ? { player: { ...NO_INPUT, fire: true } } : {}, TICK);
    far.place();
  }
  assert.equal(damageTo(far.w, "dummy"), 0);
});

test("a 600 m/s sniper bullet still hits a small target and doesn't pass through a planet's edge", () => {
  const { w, place } = range(100, "sniper");
  for (let i = 0; i < 30; i++) {
    stepWorld(w, i === 0 ? { player: { ...NO_INPUT, fire: true } } : {}, TICK);
    place();
  }
  assert.equal(damageTo(w, "dummy"), tuning.WEAPONS.sniper.damage);
  // A bullet along a chord 0.3 m inside the tiny planet's surface.
  const w2 = padless(), tiny = w2.system.byId.tiny, c = w2.poses.tiny.pos;
  const side = anyPerpendicular([0, 1, 0]), h = tiny.radius - 0.3;
  const start = add(add(c, scale([0, 1, 0], h)), scale(side, -40));
  w2.projectiles.push({ kind: "sniper", owner: "player", age: 1, pos: start, vel: add(scale(side, 600), w2.poses.tiny.vel) });
  for (let i = 0; i < 12; i++) stepProjectiles(w2, TICK);
  assert.equal(w2.projectiles.length, 0, "stopped by the planet");
});

test("the same seed fires the same spread", () => {
  const a = range(25, "minigun"), b = range(25, "minigun");
  for (let i = 0; i < 20; i++) {
    for (const x of [a, b]) {
      x.p.cooldown = 0;
      fire(x.w, x.p);
    }
  }
  assert.deepEqual(a.w.projectiles.map((q) => q.vel), b.w.projectiles.map((q) => q.vel));
  assert.ok(new Set(a.w.projectiles.map((q) => q.vel.join())).size > 1, "spread varies");
});

test("no weapon is simply better: shotgun, minigun and a long gun each win at some range", () => {
  const dps = (weapon, m) => {
    const { w, place } = range(m, weapon);
    for (let i = 0; i < 10 / TICK; i++) {
      stepWorld(w, { player: { ...NO_INPUT, fire: true } }, TICK);
      place();
    }
    return damageTo(w, "dummy") / 10;
  };
  const best = (m) => {
    const table = Object.fromEntries(["pistol", "shotgun", "minigun", "sniper", "railgun"].map((k) => [k, dps(k, m)]));
    return [Object.entries(table).sort((x, y) => y[1] - x[1])[0][0], table];
  };
  const [at5, t5] = best(5), [at25, t25] = best(25), [at80, t80] = best(80);
  assert.equal(at5, "shotgun", JSON.stringify(t5));
  assert.equal(at25, "minigun", JSON.stringify(t25));
  assert.ok(at80 === "railgun" || at80 === "sniper", JSON.stringify(t80));
});
