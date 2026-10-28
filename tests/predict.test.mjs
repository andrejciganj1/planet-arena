import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { createWorld, tickClock, stepPlayer } from "../src/sim/world.js";
import { createEntity, right, worldVel, NO_INPUT } from "../src/sim/entity.js";
import { posesAt } from "../src/sim/system.js";
import { stepProjectiles } from "../src/sim/weapons.js";
import { add, sub, scale, len, dot } from "../src/sim/vec.js";
import { PROTOCOL, snapshot, entityState, applyEntity } from "../src/net/protocol.js";
import { createPrediction } from "../src/net/predict.js";
import { createGame } from "../server/game.js";

const { TICK, NET } = tuning;
const json = (x) => JSON.parse(JSON.stringify(x));
const FIELDS = ["pos", "vel", "up", "forward", "pitch", "fuel", "weapon", "shots"];
const pick = (e) => Object.fromEntries(FIELDS.map((k) => [k, e[k]]));

// t after n ticks from t, added one tick at a time like the server's clock.
const after = (t, n) => { for (let i = 0; i < n; i++) t += TICK; return t; };

// A room with one player and that player's browser: the view starts NET.lead ticks ahead of the welcome
// and takes its player from the room's first snapshot, as the browser does.
function joined() {
  const game = createGame(tuning, { token: () => "tok" });
  const w = game.hello("a", { type: "hello", v: PROTOCOL, name: "A" });
  const view = createWorld(tuning, { solo: false });
  Object.assign(view, { cosmetic: true, selfId: w.id });
  const pred = createPrediction(view, w.id);
  pred.start(w.tick + NET.lead, after(w.t, NET.lead));
  pred.reconcile(json(snapshot(game.world, { ack: 0, slack: 0, events: [] })));
  const send = (inp) => game.input("a", { type: "input", tick: view.tick, view: view.tick - 6, input: inp });
  const catchUp = () => { while (game.world.tick < view.tick) game.step(); };
  return { game, view, pred, id: w.id, send, catchUp, server: () => game.world.entities[w.id] };
}

// A snapshot of the view's own player as it is now, for corrections the test controls.
const selfSnap = (view, e, change = (r) => r) => ({ tick: view.tick, t: view.t, entities: [change(json(entityState(e)))] });

test("server and browser compute the same player from the same inputs", () => {
  const { view, pred, send, catchUp, server } = joined();
  // Run and turn while firing, jump, boost, look down and hook the planet you left, then run again.
  const script = (i) => ({
    ...NO_INPUT,
    move: i < 60 ? [0, 1] : i < 100 ? [1, 0.5] : i < 160 ? [0, 0] : [-1, 0.3],
    yawDelta: i < 60 ? 0.02 : i >= 160 ? -0.015 : 0,
    pitchDelta: i >= 100 && i < 110 ? -0.2 : i >= 170 && i < 180 ? 0.2 : 0,
    jump: i === 60 || i === 200,
    boost: i > 60 && i < 100,
    hook: i >= 110 && i < 160,
    fire: i % 3 === 0,
    weapon: i === 250 ? "pistol" : null,
  });
  let hooked = false, flew = false;
  for (let i = 0; i < 300; i++) {
    pred.step(script(i));
    send(script(i));
    catchUp();
    assert.equal(server().alive, true);
    assert.deepEqual(pick(pred.me), pick(server()), `tick ${view.tick}`);
    hooked ||= !!pred.me.hook;
    flew ||= !pred.me.groundId;
  }
  assert.ok(hooked && flew && pred.me.shots >= 10, "the script ran, fired, flew and hooked");
});

test("a correction replays the inputs since the snapshot", () => {
  const { view, pred } = joined();
  Object.assign(pred.me, { weapon: "minigun", weapons: ["pistol", "minigun"], ammo: { minigun: 300 } }); // fires every few ticks
  const inputs = Array.from({ length: 20 }, (_, i) => ({ ...NO_INPUT, move: [0.5, 1], yawDelta: 0.01 * i, fire: true, jump: i === 3 }));
  let snap = null;
  for (let i = 0; i < 20; i++) {
    pred.step(inputs[i]);
    // The 10th tick's player, 5 m/s faster sideways than predicted.
    if (i === 9) snap = selfSnap(view, pred.me, (r) => ({ ...r, vel: add(r.vel, scale(right(pred.me), 5)) }));
  }
  const shots = view.projectiles.length;
  assert.ok(shots > 0 && view.projectiles.every((p) => p.mine), "own shots are in the view, marked mine");
  pred.reconcile(snap);
  assert.equal(view.projectiles.length, shots, "a replay spawns no shots");

  // The same state stepped on its own with inputs 11 to 20.
  const ref = createWorld(tuning, { solo: false });
  Object.assign(ref, { cosmetic: true, selfId: pred.me.id, t: snap.t, tick: snap.tick });
  ref.poses = ref.prevPoses = posesAt(ref.system, snap.t);
  const e = (ref.entities[pred.me.id] = createEntity(pred.me.id, "player", [0, 0, 0], [0, 1, 0]));
  applyEntity(e, snap.entities[0]);
  for (let i = 10; i < 20; i++) {
    tickClock(ref, TICK);
    stepPlayer(ref, e, inputs[i], TICK);
  }
  assert.equal(ref.tick, view.tick);
  assert.deepEqual(entityState(pred.me), entityState(e));
  assert.ok(len(sub(e.vel, snap.entities[0].vel)) > 0, "the replay moved on from the snapshot");
});

test("your rocket jump is predicted and survives a correction from before the blast", () => {
  const { game, view, pred, send, server } = joined();
  Object.assign(server(), { weapons: ["pistol", "rocket"], ammo: { rocket: 5 } });
  const snaps = [];
  const catchUp = () => { while (game.world.tick < view.tick) snaps.push(...game.step().map((o) => json(o.msg))); };
  // The browser's tick: predict, then fly your own shots.
  const tick = (inp) => {
    pred.step(inp);
    stepProjectiles(view, TICK);
    send(inp);
    catchUp();
  };
  tick(NO_INPUT); // the room's next snapshot carries the rocket launcher
  pred.reconcile(snaps.at(-1));
  assert.equal(pred.me.weapons.includes("rocket"), true);
  // Look at your feet, take the rocket launcher, fire, and wait for the blast.
  tick({ ...NO_INPUT, pitchDelta: -2, weapon: "rocket" });
  tick({ ...NO_INPUT, fire: true });
  const fired = view.tick;
  let blast = null;
  for (let i = 0; i < 30 && !blast; i++) {
    tick(NO_INPUT);
    if (view.explosions.length) blast = view.tick;
  }
  assert.ok(blast, "the rocket went off");
  const lift = dot(worldVel(view, pred.me), pred.me.up);
  assert.ok(pred.me.groundId === null && lift > 5, `thrown up at once (${lift} m/s)`);
  for (let i = 0; i < 4; i++) tick(NO_INPUT);
  const before = entityState(pred.me);
  // The room agrees, and its snapshot from before the blast keeps the jump after a replay.
  assert.deepEqual(pick(pred.me), pick(server()));
  const old = snaps.filter((s) => s.tick >= fired && s.tick < blast).at(-1);
  assert.ok(old, "a snapshot from between the shot and the blast");
  pred.reconcile(old);
  assert.deepEqual(entityState(pred.me), { ...before, health: entityState(pred.me).health });
  assert.equal(len(pred.offset()), 0);
});

test("small corrections are smoothed away within NET.smooth s; big ones snap", () => {
  const { view, pred } = joined();
  const n = Math.round(NET.smooth / TICK);
  pred.step({ ...NO_INPUT, jump: true });
  for (let i = 0; i < 5; i++) pred.step(NO_INPUT);
  // Told, two ticks late, that we were 1 m further right.
  const shifted = (d) => (r) => ({ ...r, pos: add(r.pos, scale(right(pred.me), d)) });
  let snap = selfSnap(view, pred.me, shifted(1));
  pred.step(NO_INPUT);
  pred.step(NO_INPUT);
  let drawn = [...pred.me.pos];
  pred.reconcile(snap);
  assert.ok(len(sub(add(pred.me.pos, pred.offset()), drawn)) < 1e-9, "no jump on screen");
  assert.ok(Math.abs(len(pred.offset()) - 1) < 0.01);
  for (let i = 0; i < n - 1; i++) pred.step(NO_INPUT);
  assert.ok(len(pred.offset()) > 0, "still easing in");
  pred.step(NO_INPUT);
  assert.deepEqual(pred.offset().map(Math.abs), [0, 0, 0]);

  snap = selfSnap(view, pred.me, shifted(NET.snap + 1));
  pred.step(NO_INPUT);
  drawn = [...pred.me.pos];
  pred.reconcile(snap);
  assert.ok(len(sub(pred.me.pos, drawn)) > NET.snap);
  assert.deepEqual(pred.offset().map(Math.abs), [0, 0, 0], "a big error snaps");
});

test("a snapshot far ahead or behind resyncs the clock instead of replaying minutes", () => {
  // Behind: a hidden tab stopped ticking while the room ran on for 10 s.
  const { game, view, pred, send, catchUp, server } = joined();
  for (let i = 0; i < 5; i++) {
    pred.step({ ...NO_INPUT, move: [0, 1] });
    send({ ...NO_INPUT, move: [0, 1] });
    catchUp();
  }
  for (let i = 0; i < 600; i++) game.step();
  const snap = json(snapshot(game.world, { ack: 0, slack: 0, events: [] }));
  pred.reconcile(snap);
  assert.equal(view.tick, snap.tick + NET.lead);
  assert.equal(view.t, after(snap.t, NET.lead));
  assert.deepEqual(view.poses, posesAt(view.system, view.t));
  // Nothing was sent for the new ticks, so the room runs them idle, as the replay did.
  for (let i = 0; i < NET.lead; i++) game.step();
  assert.deepEqual(pick(pred.me), pick(server()));

  // Ahead: the browser ran far past a snapshot it only gets now.
  const old = selfSnap(view, pred.me);
  for (let i = 0; i < NET.resync + 1; i++) pred.step({ ...NO_INPUT, move: [1, 0] });
  pred.reconcile(old);
  assert.equal(view.tick, old.tick + NET.lead);
  assert.equal(view.t, after(old.t, NET.lead));
});

test("a dead or missing own record is taken as it is", () => {
  const { view, pred, id } = joined();
  pred.step(NO_INPUT);
  pred.reconcile(selfSnap(view, pred.me, (r) => ({ ...r, alive: false, pos: [1, 2, 3] })));
  assert.equal(pred.me.alive, false);
  assert.deepEqual(pred.me.pos, [1, 2, 3]);
  const tick = view.tick;
  pred.step({ ...NO_INPUT, move: [0, 1] });
  assert.deepEqual(pred.me.pos, [1, 2, 3], "the dead don't move");
  assert.equal(view.tick, tick + 1);
  pred.reconcile({ tick: view.tick, t: view.t, entities: [] });
  assert.equal(view.entities[id], undefined);
  assert.equal(pred.me, undefined);
  pred.step(NO_INPUT);
});
