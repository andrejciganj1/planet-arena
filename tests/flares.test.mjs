// Solar flares: a schedule from the match clock alone, so the server and every client agree with nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tuning from "../src/tuning.js";
import { flareAt, burnRate, exposure } from "../src/sim/flares.js";
import { createWorld, stepWorld, spawnGap } from "../src/sim/world.js";
import { createEntity, standOn } from "../src/sim/entity.js";
import { posesAt } from "../src/sim/system.js";
import { radiusAt } from "../src/sim/shape.js";
import { NO_INPUT } from "../src/sim/entity.js";
import { add, sub, scale, norm, dot, cross, dist } from "../src/sim/vec.js";

const { FLARE, TICK } = tuning;

// Every flare's warning time from 0 to `until` s, walking the clock.
const warnings = (until, step = 0.5) => {
  const seen = [];
  for (let t = 0; t < until; t += step) {
    const f = flareAt(t);
    if (seen.at(-1) !== f.warnAt) seen.push(f.warnAt);
  }
  return seen;
};

test("the schedule is a pure function of the clock", () => {
  for (let t = 0; t < 2000; t += 7.3) assert.deepEqual(flareAt(t), flareAt(t));
});

test("no flare warns before 60 s, and warnings come 60 to 120 s apart", () => {
  const w = warnings(20000);
  assert.ok(w.length > 150, `${w.length} flares`);
  assert.ok(w[0] >= 60, `the first warns at ${w[0]}`);
  for (let i = 1; i < w.length; i++) {
    const gap = w[i] - w[i - 1];
    assert.ok(gap >= 60 && gap <= 120, `gap ${gap} after ${w[i - 1]}`);
  }
});

test("each flare warns 10 s, burns 6 s, then fades 3 s", () => {
  for (const warnAt of warnings(5000).slice(0, 50)) {
    const f = flareAt(warnAt + 0.01);
    assert.equal(f.burnAt, f.warnAt + 10);
    assert.equal(f.endAt, f.burnAt + 6);
    assert.equal(f.phase, "warn");
    assert.equal(flareAt(f.burnAt + 0.01).phase, "burn");
    assert.equal(flareAt(f.endAt + 0.01).phase, "fade");
    assert.equal(flareAt(f.endAt + FLARE.fade + 0.01).phase, "calm");
  }
});

test("a huge clock is as quick as a small one", () => {
  const f = flareAt(1e7);
  assert.ok(Math.abs(f.k - (1e7 - FLARE.first) / FLARE.every) < 2, `k ${f.k}`);
  assert.ok(f.warnAt <= 1e7 + FLARE.every + FLARE.jitter && f.endAt + FLARE.fade > 1e7);
});

// Sets the clock to t, as tickClock would have left it.
function at(world, t) {
  world.t = t;
  world.poses = world.prevPoses = posesAt(world.system, t);
  return world;
}
// The first flare's burn after t0 that `ok(world)` likes; the world is left 0.5 s into it.
function burnWhere(world, ok, t0 = 0) {
  for (let t = t0; t < 30000; ) {
    const f = flareAt(t);
    at(world, f.burnAt + 0.5);
    if (ok(world)) return f;
    t = f.endAt + FLARE.fade + 1;
  }
  throw new Error("no such flare");
}
const sunPos = (world) => world.poses.sun.pos;
// A free body with its middle (where light is judged) at p, `up` away from `from`.
const floating = (p, from) => {
  const u = norm(sub(p, from));
  return createEntity("x", "player", sub(p, scale(u, tuning.PLAYER.radius)), u);
};
// Stands `id` on `body` at the point dir (unit) from its centre.
function stand(world, id, body, dir) {
  const c = world.poses[body].pos, b = world.system.byId[body];
  const e = Object.assign(world.entities[id], createEntity(id, world.entities[id].kind, add(c, scale(dir, radiusAt(b, dir))), dir));
  standOn(e, body);
  return e;
}
const towardSun = (world, body) => norm(sub(sunPos(world), world.poses[body].pos));

test("the burn falls off with distance: full to 80 m, nothing past 150 m", () => {
  const world = createWorld(tuning);
  burnWhere(world, () => true);
  // Straight up out of the planets' plane from the sun: nothing in the way.
  const up = [0, 1, 0];
  for (const [d, want] of [[46, 25], [78, 25], [108, (25 * (150 - 108)) / 70], [150, 0], [200, 0]]) {
    const e = floating(add(sunPos(world), scale(up, d)), sunPos(world));
    assert.ok(Math.abs(burnRate(world, e) - want) < 0.05, `${d} m: ${burnRate(world, e)}, want ${want}`);
  }
});

test("standing on Hot's sunny side you die in 4 to 5 s", () => {
  const world = createWorld(tuning);
  const f = burnWhere(world, () => true);
  at(world, f.burnAt - TICK / 2);
  const e = stand(world, "player", "hot", towardSun(world, "hot"));
  let died = null;
  for (let i = 0; i < 6 / TICK && !died; i++) {
    world.events = [];
    stepWorld(world, { player: NO_INPUT }, TICK);
    died = world.events.find((ev) => ev.type === "death" && ev.id === "player");
    if (died) assert.equal(died.cause, "flare");
    if (died) assert.ok(world.t - f.burnAt >= 4 - TICK && world.t - f.burnAt <= 5, `died ${world.t - f.burnAt} s in`);
  }
  assert.ok(died, "died");
  assert.ok(!e.alive);
});

test("the night side is shelter, and the day and night line is where the ground shows it", () => {
  const world = createWorld(tuning);
  burnWhere(world, () => true);
  const b = world.system.byId.hot, c = world.poses.hot.pos, s = towardSun(world, "hot");
  const side = norm(cross(s, Math.abs(s[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const dirAt = (deg) => add(scale(s, Math.cos((deg * Math.PI) / 180)), scale(side, Math.sin((deg * Math.PI) / 180)));
  // The ground is lit where its normal faces the sun's centre: find that line, as the planet shader draws it.
  let line = 0;
  for (let deg = 0; deg < 180; deg += 0.05) {
    const u = dirAt(deg), p = add(c, scale(u, b.radius));
    if (dot(u, sub(sunPos(world), p)) < 0) break;
    line = deg;
  }
  const standing = (deg) => {
    const u = dirAt(deg);
    return { ...createEntity("x", "player", add(c, scale(u, b.radius)), u), groundId: "hot" };
  };
  assert.ok(burnRate(world, standing(line - 5)) > 0, `5 degrees on the day side of ${line}`);
  assert.equal(burnRate(world, standing(line + 5)), 0, "5 degrees into the night");
  assert.equal(burnRate(world, standing(180)), 0, "midnight");
});

test("a moon or a comet's shadow is shelter", () => {
  for (const [id, near] of [["mid-moon", 120], ["comet-a", 70]]) {
    const world = createWorld(tuning);
    burnWhere(world, (w) => dist(w.poses[id].pos, sunPos(w)) < near);
    const b = world.system.byId[id], c = world.poses[id].pos, away = norm(sub(c, sunPos(world)));
    const behind = add(c, scale(away, radiusAt(b, away) + 0.6));
    assert.equal(burnRate(world, floating(behind, c)), 0, `behind ${id}`);
    const side = norm(cross(away, Math.abs(away[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const beside = add(c, scale(side, b.radius + 2));
    assert.ok(burnRate(world, floating(beside, c)) > 0, `beside ${id}`);
  }
});

test("nothing burns outside the burn", () => {
  const world = createWorld(tuning);
  const f = flareAt(0);
  at(world, f.warnAt);
  const e = stand(world, "player", "hot", towardSun(world, "hot"));
  const until = (t) => {
    while (world.t < t) {
      stepWorld(world, { player: NO_INPUT }, TICK);
      if (world.t < f.burnAt - TICK || world.t > f.endAt + TICK) assert.equal(e.health, tuning.PLAYER.health, `at ${world.t}`);
    }
  };
  until(f.burnAt - TICK);
  at(world, f.endAt + TICK);
  stand(world, "player", "hot", towardSun(world, "hot"));
  until(f.endAt + FLARE.fade);
});

test("the dummy burns; a cosmetic world burns nobody", () => {
  const world = createWorld(tuning);
  const f = flareAt(0);
  at(world, f.burnAt + 0.1);
  const d = stand(world, "dummy", "tiny", towardSun(world, "tiny"));
  const p = stand(world, "player", "hot", towardSun(world, "hot"));
  for (let i = 0; i < 30; i++) stepWorld(world, {}, TICK);
  assert.ok(d.health < tuning.DUMMY.health, `dummy ${d.health}`);
  assert.ok(p.health < tuning.PLAYER.health, `player ${p.health}`);
  const look = createWorld(tuning);
  look.cosmetic = true;
  at(look, f.burnAt + 0.1);
  const q = stand(look, "player", "hot", towardSun(look, "hot"));
  for (let i = 0; i < 30; i++) stepWorld(look, {}, TICK);
  assert.equal(q.health, tuning.PLAYER.health);
});

test("a flare death credits the last hitter as falling into the sun does", () => {
  const world = createWorld(tuning);
  const f = flareAt(0);
  at(world, f.burnAt);
  const e = stand(world, "player", "hot", towardSun(world, "hot"));
  world.scores.other = { kills: 0, deaths: 0 };
  e.lastHitBy = "other";
  let died = null;
  for (let i = 0; i < 6 / TICK && !died; i++) {
    e.lastHitAt = world.t; // a hit that is still fresh
    world.events = [];
    stepWorld(world, {}, TICK);
    died = world.events.find((ev) => ev.type === "death" && ev.id === "player");
  }
  assert.equal(died?.cause, "flare");
  assert.equal(died.by, "other");
  assert.equal(world.scores.other.kills, 1);
  assert.ok(!world.events.some((ev) => ev.type === "hit"), "no hit events from the flare");
});

test("a respawn during a warning or a burn lands out of the flare's reach", () => {
  const world = createWorld(tuning);
  const { respawn } = tuning.PLAYER;
  let checked = 0;
  for (let t = 0; checked < 10; ) {
    const f = flareAt(t);
    // One death whose respawn falls in the warning, one in the burn.
    for (const dieAt of [f.warnAt + 1, f.burnAt]) {
      at(world, dieAt);
      for (const id of ["player", "dummy"]) world.entities[id].health = 0;
      world.events = [];
      while (world.t < dieAt + respawn + 1) stepWorld(world, {}, TICK);
      const back = world.events.filter((ev) => ev.type === "respawn").map((ev) => ev.id);
      assert.deepEqual(back.sort(), ["dummy", "player"]);
      for (const id of ["player", "dummy"]) {
        const e = world.entities[id];
        assert.equal(exposure(world, e), 0, `${id} respawned in the flare's light at ${world.t.toFixed(1)}`);
      }
      assert.equal(world.entities.player.groundId, tuning.PLAYER_BODY);
      assert.equal(world.entities.dummy.groundId, tuning.DUMMY.body);
      checked += 2;
    }
    t = f.endAt + FLARE.fade + 1;
  }
});

test("if every spot is lit, the respawn still happens", () => {
  const world = createWorld(tuning);
  at(world, flareAt(0).burnAt + 1);
  const s = spawnGap(world, "mid", "player", () => false);
  assert.ok(s && s.pos && s.up);
  assert.ok(Math.abs(dist(s.pos, world.poses.mid.pos) - world.system.byId.mid.radius) < 1e-6);
});
