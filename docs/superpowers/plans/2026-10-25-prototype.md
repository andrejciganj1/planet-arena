# Planet Arena prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-player browser prototype: one sun, three planets, one moon, one station, jump pads with a
timing cue, the booster, the pistol and the rocket launcher, and a dummy that can be blasted into the sun.
Done when the owner finds running, jumping and flying between planets fun.

**Architecture:** A pure simulation in `src/sim/` (no three.js, no DOM), stepped at a fixed 60 Hz, so the
later server can run the same code. Orbits are scripted from the match clock. A thin client in
`src/client/` reads the simulation state each frame and draws it with three.js, and turns keyboard and
mouse into the simulation's input records.

**Tech Stack:** plain ES modules; three@0.160.0 from an import map; Node 22 `node:test` for the simulation;
Playwright through `npx` for local page checks only.

**Spec:** `docs/superpowers/specs/2026-10-25-planet-arena-design.md` (stage 1 of "Order of work").

## Global Constraints

- Desktop browser from a link, no install; keyboard and mouse.
- Plain ES modules, three@0.160.0 via the import map (`https://cdn.jsdelivr.net/npm/three@0.160.0/...`);
  no bundler, no npm dependencies in the page. Local checks may use Playwright through `npx`.
- Every gameplay number lives in `src/tuning.js`. Code reads tuning; tests read tuning. When a property
  test fails, change numbers in `tuning.js` (or the layout in it), never the test's property.
- Modules under `src/sim/` import nothing from three.js or the DOM.
- Orbits are scripted from the match clock, never simulated.
- Fixed tick `1/60` s.
- Simple, cartoonish look; own assets only, nothing from Quake.
- Docs and comments: brief, explain why; no em dashes.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BDHcpruj83vPd6HijmyjJm
  ```

**Ruling (builder's call left by the spec):** no Rapier. Every shape is a sphere (sun, planets, moon,
player and dummy hit spheres, projectiles) or one box (the station); our own closest-point tests cover
them, run identically in Node, and avoid a WebAssembly dependency in the simulation. Cost if wrong: adding
Rapier later for complex station shapes.

## Review Focus

1. A slow frame or a hidden tab returns a huge elapsed time: the loop must cap ticks per frame, not
   freeze or fling everything. Test in Task 6.
2. Pointer lock lost (Esc, alt-tab) while keys are held: movement and firing must stop, no stuck keys.
   Test in Task 9.
3. "Up" flips to its opposite (falling to a body on the far side) or the view looks straight along up:
   the view frame must stay valid (unit, orthogonal), no NaN. Test in Task 1 and Task 5.
4. A moving planet sweeps into a floating player or dummy: they must end up on its surface, not inside
   it. Test in Task 5.
5. A respawn must never land on a jump pad, inside a body or next to the player. Test in Task 6.

---

## Data shapes (shared by all tasks)

- `Vec`: a plain array `[x, y, z]`, metres. World y is up for the orbital plane (orbits lie in XZ).
- `Body`: `{ id, kind: "sun"|"planet"|"moon"|"station", radius?, size?, g, reach, orbit, pos?, color }`
  - spheres have `radius`; the station has `size: [w, h, d]` and a static `pos`
  - `g` is the full pull (m/s²) within `reach` metres of the body's core, falling off as
    `g * (reach / d)²` beyond (`d` measured from the core: the centre for spheres, the station's
    mid-plane rectangle for the station); for spheres `reach = radius`
  - `orbit: { around: id, radius, period, phase } | null`
- `Pose`: `{ pos: Vec, vel: Vec }`; `Poses`: an object keyed by body id.
- `Entity` (player and dummy): `{ id, kind: "player"|"dummy", pos (feet), vel, up, forward, pitch,
  groundId, fuel, health, alive, respawnAt, weapon, cooldown, lastHitBy, lastHitAt }`
  - `up` and `forward` are unit vectors; `forward` is perpendicular to `up`
  - `groundId` is the body stood on, or `null`
- `Input`: `{ move: [strafe, ahead] (each -1..1), jump, boost, fire, weapon: null|"pistol"|"rocket",
  yawDelta, pitchDelta }`; `NO_INPUT` is the all-zero record.
- `World`: `{ tuning, system, t, poses, entities, projectiles, explosions, pads, cues, events }`
  - `cues` is keyed by pad id: `{ landsOn, path }` (Task 8)
  - `events` is an array the step appends to and the client drains:
    - `{ type: "death", id, cause: "sun"|"void"|"damage" }`
    - `{ type: "respawn", id }`
    - `{ type: "explode", pos }`
    - `{ type: "launch", id, padId }`
    - `{ type: "hit", id, damage }`

## Starting tuning (provisional: tune until the property tests pass)

| Thing | Values |
|---|---|
| Sun | radius 18, g 22, at origin |
| Tiny planet | radius 6, g 4, orbit 70 m, period 120 s, phase 0 |
| Mid planet | radius 12, g 9, orbit 120 m, period 200 s, phase 2.1 |
| Heavy planet | radius 18, g 13, orbit 200 m, period 300 s, phase 4.2 |
| Moon (of heavy) | radius 5, g 3, orbit 45 m, period 90 s, phase 0 |
| Station | size [24, 2, 16], g 3, reach 8, pos [0, 8, -92] |
| World | tick 1/60, max 5 ticks per frame, void radius 400 m |
| Player | hit radius 0.5 (collision sphere centred 0.5 m up), height 1.8, eye 1.6 |
| Ground movement | run 9 m/s, ground accel 60, friction 8, jump 6 m/s, up turn 4 rad/s |
| Booster | accel 12 m/s², fuel 1.5 s, refill 0.5 s per s on the ground |
| Pistol | 120 m/s, damage 10, cooldown 0.35 s, falls with gravity |
| Rocket | 30 m/s, cooldown 0.9 s, splash radius 4, splash damage up to 90, knockback up to 18 m/s (linear falloff), self damage x0.5 |
| Dummy | health 100, respawn 3 s, on the tiny planet |
| Jump pads | launch 28 m/s, cue refresh 0.25 s, prediction 20 s; two to three per planet, one on the station, none on the moon |

Why these: escape speed from the tiny planet is about 7 m/s and from the heavy one about 22 m/s, so a
blast that throws someone off the tiny planet leaves them on the heavy one; the tiny planet moves far
slower than a circular orbit at its distance, so whatever leaves it falls towards the sun.

---

### Task 1: Project base and vector maths

**Files:**
- Create: `src/sim/vec.js`, `src/tuning.js` (the table above, as named exports), `tests/vec.test.mjs`,
  `CLAUDE.md`, `.gitignore`, `tools/serve.py` (copy of `../bg2/tools/serve.py`)

**Interfaces:**
- Produces, in `src/sim/vec.js`: `add, sub, scale, dot, cross, len, norm, dist, lerp, projectOnPlane(v, n),
  rotateFromTo(v, from, to)` (rotates `v` by the smallest rotation taking unit `from` to unit `to`),
  `clampLen(v, max)`. All return new arrays.
- Produces, in `src/tuning.js`: `TICK, MAX_TICKS, VOID_RADIUS, BODIES` (array of `Body` without poses),
  `PLAYER, BOOST, PISTOL, ROCKET, DUMMY, PADS` (array of `{ id, body, dir, speed }`, `dir` unit in world
  axes since nothing spins), `PAD_CUE`.

- [ ] **Step 1: Write `tests/vec.test.mjs`**
  ```js
  test("rotateFromTo maps from onto to", () => near(rotateFromTo([1,0,0], [1,0,0], [0,1,0]), [0,1,0]));
  test("rotateFromTo keeps a perpendicular vector perpendicular", ...
       // v=[0,0,1], from=[1,0,0], to=[0,1,0] -> [0,0,1]
  test("rotateFromTo with opposite vectors gives a valid half turn", () => {
    const r = rotateFromTo([0,0,1], [1,0,0], [-1,0,0]);
    assert(Math.abs(len(r) - 1) < 1e-9 && Math.abs(dot(r, [1,0,0])) < 1e-9 && !r.some(Number.isNaN));
  });
  test("projectOnPlane removes the normal part", () => near(projectOnPlane([1,2,3], [0,1,0]), [1,0,3]));
  test("norm of a zero vector is zero, not NaN", () => near(norm([0,0,0]), [0,0,0]));
  ```
- [ ] **Step 2: Run** `node --test tests/` . Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/sim/vec.js` and `src/tuning.js`.** `rotateFromTo` by Rodrigues; for
  opposite vectors rotate by π about any axis perpendicular to `from`.
- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.
- [ ] **Step 5: Write `CLAUDE.md`** (run: `python3 -I tools/serve.py 8100`, open
  `http://localhost:8100`; tests `node --test tests/`; the constraints above in short) and `.gitignore`
  (`.superpowers/`, `shots/`). Commit: "Project base: vector maths and tuning".

### Task 2: The solar system

**Files:** Create `src/sim/system.js`, `tests/system.test.mjs`

**Interfaces:**
- Consumes: `BODIES` from tuning, vec functions.
- Produces: `createSystem(bodies) -> System` (`{ bodies, byId }`); `posesAt(system, t) -> Poses` (moons
  after their planets; velocity is the analytic derivative of the scripted path, including the parent's
  velocity for moons).

- [ ] **Step 1: Write the tests**
  ```js
  test("a planet returns to its start after one period", ...)       // |pos(t+period) - pos(t)| < 1e-6
  test("the moon keeps its distance from its planet", ...)          // every 1 s for 600 s: 45 ± 1e-6
  test("the station never moves", ...)
  test("vel matches the change of pos", ...)                         // central difference, 1e-3
  test("no two bodies ever touch", ...)                              // every 0.5 s for 600 s, sphere/box gaps > 3 m
  test("the same t gives the same poses", ...)
  ```
- [ ] **Step 2: Run** `node --test tests/system.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Orbit angle `phase + 2πt/period`, circle in the XZ plane about the parent.
- [ ] **Step 4: Run** all tests. Expected: pass (if "no two bodies touch" fails, move orbits in tuning).
- [ ] **Step 5: Commit** "Solar system: scripted orbits".

### Task 3: Gravity

**Files:** Create `src/sim/gravity.js`, `tests/gravity.test.mjs`

**Interfaces:**
- Consumes: `System`, `Poses`.
- Produces:
  - `bodyPull(body, pose, p) -> Vec` (towards the closest point of the core)
  - `gravityAt(system, poses, p, onlyId = null) -> Vec` (sum of all pulls, or just `onlyId`'s while
    grounded, so standing players don't slide under the sun's pull)
  - `dominantBody(system, poses, p) -> id` (the body with the strongest single pull)

- [ ] **Step 1: Write the tests**
  ```js
  test("on each body's surface its pull is its g", ...)
  test("the tiny planet pulls least at its surface of all planets", ...)
  test("1 m above every planet, moon and station deck, that body dominates", ...)  // dominantBody
  test("on the station deck, down is straight into the deck, also at its corners", ...) // angle < 1°
  test("between the tiny and mid orbits, far from both, the sun dominates", ...)
  test("10 m above the moon, the heavy planet pulls harder than the moon", ...)   // moon jumps go home
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Expected: pass.
- [ ] **Step 5: Commit** "Gravity: per body pulls, shaped for play".

### Task 4: Collision

**Files:** Create `src/sim/collide.js`, `tests/collide.test.mjs`

**Interfaces:**
- Produces:
  - `surfaceInfo(body, pose, p) -> { dist, normal, point }` (`dist` is signed from the surface)
  - `sphereContacts(system, poses, centre, r) -> [{ id, depth, normal }]` (penetrating contacts only)
  - `segmentHit(system, poses, a, b, r = 0) -> { id, f, point, normal } | null` (first hit along a to b,
    `f` in 0..1)
  - `segmentHitsSphere(a, b, c, r) -> f | null`

- [ ] **Step 1: Write the tests**
  ```js
  test("a sphere sunk 0.2 m into a planet gets depth 0.2 and the outward normal", ...)
  test("a sphere on the station's edge is pushed out sideways, not up", ...)
  test("a segment crossing a planet hits at its near side", ...)  // f matches the analytic value to 1e-6
  test("a 120 m/s bullet's tick segment through the tiny planet hits it", ...)  // no tunnelling
  test("a segment that misses returns null", ...)
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Expected: pass.
- [ ] **Step 5: Commit** "Collision: spheres, the station box, swept segments".

### Task 5: Moving on planets (player and dummy physics)

**Files:** Create `src/sim/entity.js`, `tests/entity.test.mjs`

**Interfaces:**
- Consumes: gravity, collision, vec, `PLAYER`, `BOOST`.
- Produces:
  - `createEntity(id, kind, pos, up) -> Entity`
  - `stepEntity(world, e, input, dt)`
  - `viewDir(e) -> Vec` (`forward` pitched about the right axis)
  - `NO_INPUT`
- Order inside `stepEntity`:
  1. Look: yaw `forward` about `up`, clamp `pitch` to ±89°.
  2. If grounded, carry: add the ground body's displacement since last tick.
  3. Gravity: only the ground body's while grounded.
  4. On the ground: accelerate in the tangent plane towards `move`, friction, and jump along `up` adding
     the ground body's velocity.
  5. In the air: booster.
  6. Integrate.
  7. Resolve `sphereContacts`: push out, remove the velocity into the surface relative to that body.
  8. Grounded if a contact's normal is within 45° of `up`.
  9. Turn `up` towards the ground normal (grounded) or towards `-gravity` of the `dominantBody` (in the
     air) at no more than the up-turn rate, and carry `forward` with `rotateFromTo`.
  10. Re-orthonormalise.
- Booster: in the air, while `boost` and `fuel > 0`, thrust `BOOST.accel` along
  `norm(viewDir * ahead + right * strafe)`, or along `up` when `move` is zero; `fuel -= dt`. On the
  ground, `fuel` refills at `BOOST.refill` per second, up to `BOOST.fuel`.

- [ ] **Step 1: Write the tests** (a `makeWorld()` helper in `tests/helpers.mjs`: system, poses at t,
  `step(n)` advancing `t` and poses each tick)
  ```js
  test("standing 10 s on each planet: stays on its spot on the moving surface", ...)
       // altitude within 0.05 m, and within 0.1 m of its start point in the body's frame
  test("a jump on the tiny planet comes back down", ...)            // grounded again within 5 s
  test("walking ahead 10 s on the mid planet keeps to the surface", ...)
  test("the booster empties after 1.5 s of thrust and refills on the ground", ...)
  test("falling to another body turns up towards it; forward stays unit and perpendicular", ...)
  test("up flipping to its opposite leaves a valid frame, no NaN", ...)  // Review Focus 3
  test("standing on the station deck's corner and on the moon is stable", ...)
  test("a planet sweeping into a floating dummy leaves it on the surface, not inside", ...) // Review Focus 4
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Expected: pass.
- [ ] **Step 5: Commit** "Movement on moving planets, with the booster".

### Task 6: The world, the sun and the void

**Files:** Create `src/sim/world.js`, `tests/world.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `createWorld(tuning) -> World` (player spawned on the mid planet, dummy on the tiny planet)
  - `stepWorld(world, inputs, dt)` (`inputs` keyed by entity id; missing means `NO_INPUT`; steps
    entities, then projectiles and explosions once Task 7 adds them, then deaths and respawns)
  - `advance(world, acc, elapsed, inputs) -> acc` (fixed ticks from real elapsed time, at most
    `MAX_TICKS` per call, carrying the remainder)
  - `spawnPoint(world, bodyId) -> { pos, up }`
- Deaths:
  - inside the sun's radius: `death` with cause `sun`
  - beyond `VOID_RADIUS` from the sun: cause `void`
  - health ≤ 0: cause `damage`
  - the dead are respawned after `DUMMY.respawn` (player: same delay) at `spawnPoint`, with full health,
    full fuel and the pistol
- `spawnPoint`: on the given body's surface, at least 4 m from any pad, and for the player at least 20 m
  from the other entity; it tries points in a fixed order, so the same world gives the same point.

- [ ] **Step 1: Write the tests**
  ```js
  test("an entity placed in the sun dies with cause sun", ...)
  test("an entity beyond the void radius dies with cause void", ...)
  test("the dummy respawns on the tiny planet 3 s after dying", ...)
  test("respawn points are on the surface, clear of pads, not inside a body", ...) // Review Focus 5
  test("advance runs at most MAX_TICKS ticks for a 10 s gap", ...)  // Review Focus 1
  test("advance carries the remainder", ...)                        // 2.5 ticks then 0.5 -> 3 ticks
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Expected: pass.
- [ ] **Step 5: Commit** "World: sun and void deaths, respawns, fixed ticks".

### Task 7: Pistol and rocket launcher

**Files:** Create `src/sim/weapons.js`, `tests/weapons.test.mjs`; modify `src/sim/world.js` (call
`stepProjectiles` and fire in `stepWorld`)

**Interfaces:**
- Produces:
  - `fire(world, e)` (from the eye, along `viewDir`, adding the shooter's velocity; honours `cooldown`)
  - `stepProjectiles(world, dt)` (gravity via `gravityAt`, swept with `segmentHit` against bodies and
    `segmentHitsSphere` against living entities other than the shooter in their first 0.1 s)
  - `explode(world, pos, ownerId)` (splash damage and knockback, falling off linearly to zero at the
    splash radius, measured to each entity's hit sphere centre; knockback is a velocity change away from
    the blast and un-grounds the entity; owner takes x0.5 damage, full knockback)
- Hits set `lastHitBy` and `lastHitAt` (used by scoring in stage 2), push `hit` events, and pistol hits
  deal `PISTOL.damage`; rockets explode on any hit, and in the sun or the void just vanish.

- [ ] **Step 1: Write the tests**
  ```js
  test("a pistol bullet fired level on the mid planet falls with gravity", ...)
  test("a rocket curves towards the planet it was fired across", ...)
  test("a rocket that hits the ground explodes there", ...)          // explode event within 0.5 m
  test("splash damage falls off with distance and stops at the radius", ...)
  test("a rocket jump on the heavy planet lifts the player and lands them back", ...)
  test("a rocket under the dummy on the tiny planet sends it into the sun", ...)  // THE SIGNATURE MOMENT
       // dummy standing, sun-facing side; rocket bursts 1 m below its feet; death cause "sun" within 20 s
  test("the same blast on the heavy planet doesn't throw the dummy off", ...)     // grounded again within 5 s
  test("thrown off the tiny planet, a full booster can bring you back", ...)
       // same blast on a player; boost towards the tiny planet's centre: grounded on it, alive
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Expected: pass; if one of the last three fails, tune `ROCKET`, `BOOST`
  or the planets in `tuning.js` until all three pass together.
- [ ] **Step 5: Commit** "Pistol and rocket launcher: gravity, splash, knockback".

### Task 8: Jump pads and their timing cue

**Files:** Create `src/sim/pads.js`, `tests/pads.test.mjs`; modify `src/sim/world.js` (launch on touch)

**Interfaces:**
- Produces:
  - `padPos(world, pad, poses) -> Vec`
  - `launch(world, e, pad)` (`vel = ground body's vel + pad.dir * pad.speed`, un-grounds, `launch`
    event; a grounded entity's feet within 1.2 m of the pad launch it; a 1 s lockout stops relaunching)
  - `predictLaunch(world, pad, t) -> { landsOn: id | null, path: Vec[] }`
    - copies a fresh dummy-like entity onto the pad at time `t` and launches it
    - steps it with `stepEntity` and `NO_INPUT` for at most `PAD_CUE.predict` s, on poses for each future
      tick: the same physics as play, so the cue can't lie
    - `landsOn` is the first body other than the pad's own that it stands on, or `null` for the sun, the
      void, the home body or a timeout
  - `refreshCues(world)` (every `PAD_CUE.refresh` s, stores `world.cues[padId]`)

- [ ] **Step 1: Write the tests**
  ```js
  test("every pad has at least one 5 s window in the first 10 minutes", ...)  // sampled every 0.5 s
  test("from every planet, some pad's cue is on at least once a minute", ...)  // longest gap <= 60 s
  test("launching while the cue is on lands on the predicted body", ...)      // full stepWorld run
  test("a jump from the moon, anywhere on it, at any time, ends on the moon or its planet", ...)
       // 8 points round the moon x 6 times in one moon period; jump plus no input; never sun or void
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Expected: pass (if the window tests fail, move pads or add one per planet
  in tuning, at most three per planet).
- [ ] **Step 5: Commit** "Jump pads with a timing cue that uses the game's own physics".

### Task 9: The page: drawing, controls, HUD

**Files:**
- Create: `index.html`, `src/client/main.js`, `src/client/render.js`, `src/client/input.js`,
  `src/client/hud.js`, `tests/input.test.mjs`, `tools/page_check.cjs`
- Modify: `CLAUDE.md` (controls, checks)

**Interfaces:**
- Consumes: `createWorld`, `advance`, `viewDir`, `world.cues`, `world.events`.
- Produces:
  - `createInput() -> { onKey(code, down), onMouseMove(dx, dy), onButton(b, down), onWheel(dy), onBlur(),
    take() -> Input }` (pure, no DOM; `take()` returns the input for the next tick and zeroes the look
    deltas; `main.js` wires DOM events to it)
  - `?debug` exposes `window.game = { world }`
  - `?view=x,y,z,tx,ty,tz` fixes a free camera for screenshots
- Controls (from the spec):
  - mouse look with pointer lock (click to capture), WASD move, space jump
  - space held in the air boosts
  - left mouse fires; 1 = pistol, 2 = rocket launcher, wheel cycles
- Drawing:
  - flat-shaded spheres for the sun, planets and moon, each with its own colour; the sun emissive with a
    soft glow sprite
  - a box for the station; a starfield of points
  - pads as short cylinders, green when `world.cues[id].landsOn` isn't null, red otherwise, and the
    predicted path as a thin line while you stand within 15 m of a pad
  - the dummy as a cartoon capsule with a face
  - rockets as small capsules, pistol bullets as dots, explosions as expanding spheres fading out
  - the weapon in view: the pistol as two cuboids, the launcher as a tube
- The camera sits at `pos + up * eye`, looks along `viewDir`, with `up` as its up.
- HUD:
  - booster bar, weapon name, crosshair
  - dummy health, and a "Sun kill!" toast on the dummy's sun death
  - "Click to play" while pointer lock is off

- [ ] **Step 1: Write `tests/input.test.mjs`**
  ```js
  test("W and D give move [1, 1]", ...)
  test("losing focus releases every key and the fire button", ...)  // Review Focus 2: take() == NO_INPUT
  test("mouse movement becomes look deltas once, then zero", ...)
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `input.js`, then the page.
- [ ] **Step 4: Run** `node --test tests/` (all pass), `for f in src/*.js src/sim/*.js src/client/*.js; do node --check $f; done`, then the page check:
  `python3 -I tools/serve.py 8100 &` and
  `NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/page_check.cjs "http://localhost:8100/?debug" shots/start.png`
  (`page_check.cjs` exits 1 on any page error or console error and prints `world.t` after 5 s, which
  must be about 5).
  - Expected: `OK`.
  - Take and look at three shots with `?view=`: the whole system from above, standing on the mid planet
    looking at the sun, and next to a pad showing its cue and path.
- [ ] **Step 5: Commit** "The page: solar system, controls, HUD".

### Task 10: Hand-over for the first playtest

**Files:** Create `README.md` (how to start it, controls, which tuning numbers change what)

- [ ] **Step 1:** Run all tests and the page check again. Expected: all pass, `OK`.
- [ ] **Step 2:** Write `README.md`; commit "README for the first playtest".
- [ ] **Step 3:** Hand the owner the local link (`python3 -I tools/serve.py 8100`, then
  `http://localhost:8100`) and the questions for the playtest:
  - Does running feel fast enough?
  - Are jumps and the booster right?
  - Is the sun kill satisfying?
  - Are the pad windows too rare?
