import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld } from "../src/sim/world.js";
import { createEntity } from "../src/sim/entity.js";
import { fire } from "../src/sim/weapons.js";
import { pickupPos } from "../src/sim/pickups.js";
import { add, scale, dist } from "../src/sim/vec.js";
import { createDirector, SOUNDS } from "../src/client/sounds.js";

const { SOUND, PLAYER } = tuning;
const FRAME = 1 / 60;
const on = { get: () => true };
const hitsOff = { get: (name) => name !== "hits" };

// A world holding only the entities a test puts in, each standing still in open space.
function scene(ids = ["me"]) {
  const w = createWorld(tuning, { solo: false });
  for (const [k, id] of ids.entries()) w.entities[id] = createEntity(id, "player", [10 * k, 50, 0], [0, 1, 0]);
  return w;
}
// One frame of `dt` real time: the clock moves on by the same, then the director looks.
const play = (d, w, events = [], dt = FRAME, settings = on) => {
  w.t += dt;
  return d.frame(w, events, dt, settings);
};
const names = (out) => out.once.map((s) => s.name);
const eye = (e) => add(e.pos, scale(e.up, PLAYER.eye));
const near = (a, b) => assert.ok(a && b && dist(a, b) < 1e-9, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
// Gives e a weapon with n rounds, in hand.
const arm = (e, weapon, n) => {
  e.weapons.push(weapon);
  e.ammo[weapon] = n;
  e.weapon = weapon;
};

test("the list of sounds is the one Task 3 makes recipes for", () => {
  assert.deepEqual([...SOUNDS].sort(), [
    "pistol", "shotgun", "rocket", "minigun", "sniper", "railgun", "rocketFlight", "explode", "rockIncoming", "rockBurn",
    "ding", "hurt", "death", "announcer", "boink", "pickup", "pickupBack", "step", "hookFire", "hookPull", "boost",
    "switch", "empty",
  ].sort());
  for (const w of tuning.WEAPON_ORDER) assert.ok(SOUNDS.includes(w), `${w} fires a sound of its own name`);
});

test("ten pellets of one shot make one shotgun sound", () => {
  const w = scene(["me"]), me = w.entities.me, d = createDirector({ selfId: "me", online: false });
  arm(me, "shotgun", 8);
  play(d, w);
  assert.ok(fire(w, me));
  assert.equal(w.projectiles.length, 10);
  const out = play(d, w);
  assert.deepEqual(names(out), ["shotgun"]);
  near(out.once[0].pos, eye(me));
  assert.equal(out.once[0].own, true);
  assert.deepEqual(names(play(d, w)), [], "the pellets in flight make no more");
});

test("each shot sounds once by the weapon that fired it, the last round too, then the empty click", () => {
  const w = scene(["me", "you"]), me = w.entities.me, you = w.entities.you;
  const d = createDirector({ selfId: "me", online: false });
  arm(me, "rocket", 1);
  play(d, w);
  fire(w, me);
  fire(w, you);
  assert.equal(me.weapon, "pistol", "the empty launcher hands over the pistol");
  const out = play(d, w);
  assert.deepEqual(names(out).sort(), ["empty", "pistol", "rocket"]);
  const theirs = out.once.find((s) => s.name === "pistol");
  near(theirs.pos, eye(you));
  assert.equal(theirs.own, false);
  assert.equal(out.once.find((s) => s.name === "empty").pos, null, "the click is in your head");
});

test("switching weapons clicks for you only", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: false });
  arm(w.entities.me, "minigun", 50);
  arm(w.entities.you, "minigun", 50);
  play(d, w);
  w.entities.me.weapon = "pistol";
  w.entities.you.weapon = "pistol";
  assert.deepEqual(names(play(d, w)), ["switch"]);
  w.entities.me.weapon = "minigun"; // from the pistol, which never runs out: a switch, not an empty click
  assert.deepEqual(names(play(d, w)), ["switch"]);
});

test("a hit you made dings only when hits is on", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: false });
  play(d, w);
  const hit = (id, by) => ({ type: "hit", id, damage: 10, by, from: [0, 0, 0] });
  const out = play(d, w, [hit("dummy", "me")]);
  assert.deepEqual(names(out), ["ding"]);
  assert.equal(out.once[0].pos, null);
  assert.deepEqual(names(play(d, w, [hit("you", "me")], FRAME, hitsOff)), []);
  assert.deepEqual(names(play(d, w, [hit("you", "dummy")])), [], "someone else's hit");
  const hurt = play(d, w, [hit("me", "you")]);
  assert.deepEqual(names(hurt), ["hurt"]);
  assert.equal(hurt.once[0].pos, null);
  assert.deepEqual(names(play(d, w, [hit("me", "me")])), ["hurt"], "your own blast hurts, it is no hit to ding");
});

test("your death is in your head, another's where it fell", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: false });
  play(d, w);
  const mine = play(d, w, [{ type: "death", id: "me", cause: "damage", by: "you", pos: [1, 2, 3] }]);
  assert.deepEqual(names(mine), ["death"]);
  assert.equal(mine.once[0].pos, null);
  const theirs = play(d, w, [{ type: "death", id: "you", cause: "void", by: null, pos: [4, 5, 6] }]);
  assert.deepEqual(names(theirs), ["death"]);
  near(theirs.once[0].pos, [4, 5, 6]);
});

test("a sun kill by you plays the announcer; by someone else, quieter", () => {
  const w = scene(["me", "you", "them"]), d = createDirector({ selfId: "me", online: false });
  play(d, w);
  const sun = (id, by) => ({ type: "death", id, cause: "sun", by, pos: [0, 0, 0] });
  const mine = play(d, w, [sun("you", "me")]).once.find((s) => s.name === "announcer");
  assert.ok(mine && mine.pos === null && (mine.gain ?? 1) === 1, JSON.stringify(mine));
  const theirs = play(d, w, [sun("them", "you")]).once.find((s) => s.name === "announcer");
  assert.ok(theirs && theirs.pos === null && theirs.gain === SOUND.announcerOthers, JSON.stringify(theirs));
  assert.ok(!names(play(d, w, [sun("you", null)])).includes("announcer"), "a fall in alone is no kill");
  assert.ok(!names(play(d, w, [{ ...sun("you", "me"), cause: "damage" }])).includes("announcer"));
});

test("blasts, burns, pad launches and pickups sound where they happen", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: false });
  play(d, w);
  const out = play(d, w, [
    { type: "explode", pos: [1, 1, 1], id: "you.3.0" },
    { type: "burn", id: "rock.2", pos: [2, 2, 2] },
    { type: "launch", id: "you", padId: "p" },
    { type: "pickup", id: "me", pickupId: "mid-health" },
    { type: "respawn", id: "you" },
  ]);
  assert.deepEqual(names(out), ["explode", "rockBurn", "boink", "pickup"]);
  near(out.once[0].pos, [1, 1, 1]);
  near(out.once[1].pos, [2, 2, 2]);
  near(out.once[2].pos, w.entities.you.pos);
  near(out.once[3].pos, w.entities.me.pos);
  assert.deepEqual(out.once.map((s) => s.own), [false, false, false, true]);
});

test("another's railgun sounds from its beam, yours from your shot counter", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: false });
  arm(w.entities.me, "railgun", 5);
  arm(w.entities.you, "railgun", 5);
  play(d, w);
  fire(w, w.entities.me);
  fire(w, w.entities.you);
  const beams = w.events.filter((e) => e.type === "beam");
  assert.deepEqual(beams.map((b) => b.owner), ["me", "you"]);
  const out = play(d, w, beams);
  assert.deepEqual(names(out), ["railgun", "railgun"]);
  const own = out.once.find((s) => s.own), theirs = out.once.find((s) => !s.own);
  near(own.pos, eye(w.entities.me));
  near(theirs.pos, beams[1].from);
});

test("your own launch sounds once online: the server's echo is skipped", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: true });
  play(d, w);
  const launch = { type: "launch", id: "me", padId: "p" };
  assert.deepEqual(names(play(d, w, [launch])), ["boink"], "predicted here, at once");
  assert.deepEqual(names(play(d, w, [{ ...launch, remote: true }])), []);
  assert.deepEqual(names(play(d, w, [{ ...launch, id: "you", remote: true }])), ["boink"], "someone else's");
});

test("your own rocket blast sounds online, the server's too when your prediction missed it", () => {
  // online.js drops the server's echo of a blast your prediction drew (tests/online.test.mjs), so a remote
  // blast of yours that reaches the director is one your screen never had: it sounds, as it is drawn.
  const w = scene(["me"]), d = createDirector({ selfId: "me", online: true });
  play(d, w);
  const blast = { type: "explode", pos: [0, 80, 0], id: "me.3.0" };
  const predicted = play(d, w, [blast]).once;
  assert.deepEqual(predicted.map((s) => [s.name, s.own]), [["explode", true]]);
  const missed = play(d, w, [{ ...blast, id: "me.4.0", remote: true }]).once;
  assert.deepEqual(missed.map((s) => [s.name, s.own]), [["explode", true]]);
  // Someone whose id starts like yours, and a rock, are other blasts.
  const others = play(d, w, [{ ...blast, id: "me2.3.0", remote: true }, { ...blast, id: "rock.4", remote: true }]).once;
  assert.deepEqual(others.map((s) => [s.name, s.own]), [["explode", false], ["explode", false]]);
});

test("the hook fires once and pulls while it holds", () => {
  const w = scene(["me"]), me = w.entities.me, d = createDirector({ selfId: "me", online: false });
  play(d, w);
  me.hook = { body: "mid", offset: [0, 12, 0], len: 10 };
  const out = play(d, w);
  assert.deepEqual(names(out), ["hookFire"]);
  near(out.once[0].pos, eye(me));
  assert.ok(out.loops.get("hook:me")?.name === "hookPull");
  const held = play(d, w);
  assert.deepEqual(names(held), []);
  assert.ok(held.loops.has("hook:me"));
  me.hook = null;
  assert.ok(!play(d, w).loops.has("hook:me"));
});

test("the booster hisses while fuel falls in the air, through frames with no news, and stops after", () => {
  const w = scene(["you"]), you = w.entities.you, d = createDirector({ selfId: "me", online: true });
  play(d, w);
  // Snapshots bring another's fuel every other frame.
  for (let f = 0; f < 10; f++) {
    if (f % 2 === 0) you.fuel -= 2 * FRAME;
    const out = play(d, w);
    assert.equal(out.loops.get("boost:you")?.name, "boost", `frame ${f}`);
    assert.equal(out.loops.get("boost:you").own, false);
  }
  let out;
  for (let f = 0; f < 30; f++) out = play(d, w);
  assert.ok(!out.loops.has("boost:you"), "fuel steady: the hiss stops");
  you.groundId = "mid";
  you.fuel += 0.01; // refilling on the ground
  assert.ok(!play(d, w).loops.has("boost:you"));
});

test("walking makes a step every stride; slow, airborne or dead makes none", () => {
  const steps = (setup, secs = 2) => {
    const w = scene(["me"]), me = w.entities.me, d = createDirector({ selfId: "me", online: false });
    Object.assign(me, { groundId: "mid" });
    setup(me);
    let n = 0;
    for (let f = 0; f < secs / FRAME; f++) n += names(play(d, w)).filter((x) => x === "step").length;
    return n;
  };
  const speed = 2 * SOUND.stepSpeed;
  const n = steps((me) => (me.vel = [speed, 0, 0]));
  assert.ok(Math.abs(n - (2 * speed) / SOUND.stride) <= 1, `${n} steps`);
  assert.equal(steps((me) => (me.vel = [SOUND.stepSpeed / 2, 0, 0])), 0);
  assert.equal(steps((me) => Object.assign(me, { vel: [speed, 0, 0], groundId: null })), 0);
  assert.equal(steps((me) => Object.assign(me, { vel: [speed, 0, 0], alive: false })), 0);
});

test("rockets hiss and rocks rumble while they fly", () => {
  const w = scene(["me"]), d = createDirector({ selfId: "me", online: false });
  w.projectiles.push({ id: "me.1.0", kind: "rocket", owner: "me", pos: [1, 0, 0] }, { id: "you.1.0", kind: "rocket", owner: "you", pos: [2, 0, 0] }, { id: "me.2.0", kind: "pistol", owner: "me", pos: [3, 0, 0] });
  w.asteroids.push({ id: "rock.7", pos: [4, 0, 0] });
  const { loops } = play(d, w);
  assert.deepEqual([...loops.keys()].sort(), ["rock:rock.7", "rocket:me.1.0", "rocket:you.1.0"]);
  assert.equal(loops.get("rocket:me.1.0").own, true);
  assert.equal(loops.get("rocket:you.1.0").own, false);
  assert.equal(loops.get("rock:rock.7").name, "rockIncoming");
  near(loops.get("rock:rock.7").pos, [4, 0, 0]);
  w.projectiles = [];
  w.asteroids = [];
  assert.equal(play(d, w).loops.size, 0);
});

test("a pickup coming back chimes once", () => {
  const w = scene(["me"]), d = createDirector({ selfId: "me", online: false });
  const pk = tuning.PICKUPS.find((p) => p.id === "mid-health");
  w.pickups[pk.id] = { readyAt: w.t + 0.1 };
  w.pickups["tiny-health"] = { readyAt: w.t + 100 };
  play(d, w);
  const heard = [];
  for (let f = 0; f < 30; f++) heard.push(...play(d, w).once);
  assert.deepEqual(heard.map((s) => s.name), ["pickupBack"]);
  near(heard[0].pos, pickupPos(w, pk, w.poses));
  // Taken again: a new readyAt ahead is no chime.
  w.pickups[pk.id] = { readyAt: w.t + 0.1 };
  assert.deepEqual(names(play(d, w)), []);
});

test("after a 2 s gap nothing but events plays", () => {
  const w = scene(["me", "you"]), me = w.entities.me, d = createDirector({ selfId: "me", online: false });
  arm(me, "minigun", 50);
  Object.assign(w.entities.you, { groundId: "mid", vel: [9, 0, 0] });
  w.pickups["mid-health"] = { readyAt: w.t + 1 };
  play(d, w);
  me.shots += 20;
  me.weapon = "pistol";
  me.hook = { body: "mid", offset: [0, 12, 0], len: 10 };
  const out = play(d, w, [{ type: "explode", pos: [0, 0, 0], id: "rock.1" }], 2);
  assert.deepEqual(names(out), ["explode"]);
  assert.deepEqual(names(play(d, w)), [], "and the frame after has nothing left over");
});

test("a respawn is not a burst of steps", () => {
  const w = scene(["me", "you"]), you = w.entities.you, d = createDirector({ selfId: "me", online: false });
  Object.assign(you, { groundId: "mid", vel: [9, 0, 0] });
  for (let f = 0; f < 10; f++) play(d, w);
  you.alive = false;
  for (let f = 0; f < 10; f++) play(d, w);
  // Back elsewhere with a fresh kit: moved far, new weapon and fuel, already running.
  Object.assign(you, { alive: true, pos: [500, 0, 0], weapon: "pistol", fuel: 1.5, shots: you.shots + 1 });
  assert.deepEqual(names(play(d, w)), []);
});

test("a server reset (clock back to 0) plays no state sounds", () => {
  const w = scene(["me", "you"]), d = createDirector({ selfId: "me", online: true });
  w.t = 50;
  w.entities.you.shots = 9;
  w.pickups["mid-health"] = { readyAt: 49 };
  play(d, w);
  // A restarted server: the clock starts over, everyone is a new entity with nothing fired yet.
  w.t = 0;
  w.entities = { me: createEntity("me", "player", [0, 50, 0], [0, 1, 0]), you: createEntity("you", "player", [5, 50, 0], [0, 1, 0]) };
  Object.assign(w.entities.you, { hook: { body: "mid", offset: [0, 12, 0], len: 10 }, groundId: "mid", vel: [9, 0, 0] });
  w.pickups["mid-health"] = { readyAt: 0.01 };
  assert.deepEqual(names(play(d, w)), []);
  // From there on, the new counts sound as usual.
  w.entities.you.shots = 1;
  assert.deepEqual(names(play(d, w)), ["pistol"]);
});

test("someone seen for the first time is quiet, but a hook they hold already pulls", () => {
  const w = scene(["me"]), d = createDirector({ selfId: "me", online: true });
  play(d, w);
  w.entities.you = Object.assign(createEntity("you", "player", [5, 50, 0], [0, 1, 0]), { shots: 7, hook: { body: "mid", offset: [0, 12, 0], len: 10 } });
  const out = play(d, w);
  assert.deepEqual(names(out), []);
  assert.ok(out.loops.has("hook:you"));
});

test("a shot count put back by a correction does not sound twice", () => {
  const w = scene(["me"]), me = w.entities.me, d = createDirector({ selfId: "me", online: true });
  me.shots = 4;
  play(d, w);
  const counts = [5, 4, 5, 6].map((n) => {
    me.shots = n;
    return names(play(d, w)).length;
  });
  assert.deepEqual(counts, [1, 0, 0, 1]);
});
