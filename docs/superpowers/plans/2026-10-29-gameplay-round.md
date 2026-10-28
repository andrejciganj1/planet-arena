# Gameplay Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asteroids from the belt, three new moons (one with pads), no adrift death, evenly paced comets, O/P
toggles for orbit lines and pad cues, and a head-and-body hit shape, in solo and online.

**Architecture:** Every rule lives in `src/sim/` and runs the same in the solo world and on the server.
Asteroids are a new list on the world (`world.asteroids`) beside `world.projectiles`, launched by a pure hash
of their launch number so no shared random state is involved; online, the server sends them in snapshots and
the browser draws them between snapshots like other players' shots. Players are hit on two spheres (head and
body) read from tuning, with the same lag compensation as today. Toggles are browser-only settings.

**Tech Stack:** plain ES modules, three@0.160.0 (import map), Node 22 `node:test`, `ws` on the server.

**Spec:** `docs/superpowers/specs/2026-10-28-gameplay-round-design.md`

## Global Constraints

- Every gameplay number lives in `src/tuning.js`. When a property test fails, change the numbers, never the
  test's property. The properties this round deliberately replaces are named in the tasks (adrift death,
  Kepler comet timing, "no pads on the moon", "the moon" tests becoming "every moon").
- `src/sim/` imports nothing from three.js or the DOM. `src/net/` has no three.js, DOM or Node-only APIs.
- Orbits are scripted from the match clock, never simulated. Fixed tick 1/60 s.
- Plain ES modules, no bundler, no npm packages in the page. The server may use `ws`.
- Every orbit period divides `CYCLE` (25200 s).
- Docs and comments brief, explain why, no em dashes. Code matches the surrounding style.
- Tests: `node --test 'tests/*.test.mjs'` (glob quoted). Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and use the repo's configured noreply email.
- Nothing is deployed or pushed by the plan; the owner decides that.

## Review Focus

1. An asteroid launched where a body already is (the heavy planet's moon dips to the belt's outer edge):
   it must not explode on its first tick. Pinned in Task 5 ("no launch point is inside or touching a body").
2. Chain blasts: an asteroid blast that sets off another asteroid, whose blast reaches the first again. Each
   asteroid explodes at most once, and the chain ends. Pinned in Task 5.
3. Online, your own bullet meeting an asteroid on your screen: it must not fly on through it (a visible miss
   that the server then calls a hit). The cosmetic world stops the bullet and waits for the server's blast.
   Pinned in Task 6.
4. A game reset (everyone left) while asteroids are flying: the new world starts with none, and the launch
   count restarts with the clock. Pinned in Task 6.
5. Browser storage blocked or throwing (private windows): toggles fall back to "shown" and never throw.
   Pinned in Task 8.

---

### Task 1: Shots hit what you see (head and body spheres)

**Files:**
- Modify: `src/tuning.js` (PLAYER), `src/sim/entity.js`, `src/sim/lag.js`, `src/sim/weapons.js`,
  `src/client/render.js` (player figure), tests touching `PLAYER.radius` as a hit size
- Test: `tests/weapons.test.mjs`, `tests/lag.test.mjs`

**Interfaces:**
- Produces: `PLAYER.hit = { body: { at: 0.4, r: 0.4 }, head: { at: 1.25, r: 0.55 } }` (metres along `up`
  from the feet; the head sphere is the bubble helmet's outer shape, top at 1.8 m).
  `hitSpheres(pos, up) -> [[centre, r], [centre, r]]` (entity.js, body first).
  `seenPose(world, e, lag) -> { pos, up }` (lag.js) replaces `seenCentre`; callers build spheres from it.
  `segmentHitsPlayer(a, b, pos, up) -> f | null` (entity.js): the smaller `segmentHitsSphere` fraction of the
  two spheres. `nearestSphere(p, pos, up) -> { centre, d }` for blasts.
- `hitCentre` and `PLAYER.radius` stay as they are for movement, ground contact and the sun death.

- [ ] **Step 1: Write the failing tests** in `tests/weapons.test.mjs`:
  - `"a shot at the head hits: 1.6 m up, where today's sphere misses"`: a railgun ray and a pistol bullet
    aimed level at a standing dummy 1.6 m above its feet both hit (a `hit` event for the dummy).
  - `"a shot just over the helmet misses"`: the same ray at 1.85 m up gets no hit event.
  - `"a blast is measured to the nearer sphere"`: a rocket blast 1.0 m straight above the head centre
    (1.85 m from the body centre) damages as if 1.0 m away (`ROCKET.damage * (1 - 1.0 / ROCKET.splash)`).
  In `tests/lag.test.mjs`: `"a head shot where the shooter saw the head hits with lag, misses without"`.
- [ ] **Step 2: Run** `node --test tests/weapons.test.mjs tests/lag.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Add the interfaces above. `rail`, `stepProjectiles` and `explode` use them for
  every entity (the owner's own spheres unrewound, as today with `hitCentre`). Draw the player and dummy as a
  body sphere and a head sphere of exactly these sizes (the face on the head's forward side), so what you
  see is what you hit until the look round's alien arrives.
- [ ] **Step 4: Run the full suite.** Expected: all pass. Existing tests that placed targets with
  `PLAYER.radius` as the hit size are set up again with the new spheres; if a property such as "no weapon is
  simply better" fails, change weapon numbers, not the property.
- [ ] **Step 5: Commit** `Shots hit the head and body you see`.

### Task 2: Floating is no longer a death

**Files:** Modify `src/tuning.js` (remove `PLAYER.adrift`), `src/sim/world.js:192`. Test: `tests/world.test.mjs`.

- [ ] **Step 1:** Replace the test `"an entity adrift too long is lost to the void"` with
  `"floating for 60 s inside the system is not a death"`: the dummy placed 30 m above the far planet's orbit
  path, out of every body's reach, vel zero; step 60 s; it is alive unless it reached `VOID_RADIUS` or a body.
  (Pick a spot whose 60 s fall stays clear; assert `alive` and no death event.)
- [ ] **Step 2: Run** `node --test tests/world.test.mjs`. Expected: FAIL (dies at 25 s).
- [ ] **Step 3:** Remove `PLAYER.adrift` and the `airTime` condition. `airTime` stays on entities (tests and
  later rounds read it). The "beyond the void radius" test stays.
- [ ] **Step 4: Run the full suite.** Expected: all pass.
- [ ] **Step 5: Commit** `Floating in space no longer kills; only leaving the system does`.

### Task 3: Three new moons, one with pads

**Files:** Modify `src/tuning.js` (BODIES, PADS, PICKUPS); tests `tests/system.test.mjs`,
`tests/pads.test.mjs`, `tests/pickups.test.mjs`.

**Interfaces:** Produces body ids `mid-moon` (around mid), `ring-moon` (around giant, its orbit inside the
ring band, radius between 1.4 and 2.3 giant radii; the ring is looks only), `outer-moon` (around giant,
beyond the ring). All `kind: "moon"`, circular orbits like `moon`. Pads `outer-moon-a`, `outer-moon-b`.

- [ ] **Step 1: Change the tests first** (these are the deliberate property changes):
  - system: `"the moon keeps its distance"` becomes `"every moon keeps its distance from its planet"`
    (loop over `kind === "moon"`); `"there are four moons: one round heavy, two round giant, one round mid"`;
    the belt test also checks every moon's path (planet orbit ± moon orbit ± moon radius) except the existing
    `moon`, which the comment already allows through the belt's edge.
  - pads: `"pads sit on their bodies' surfaces; two to three per planet, none on the moon"` becomes
    `"…; two to three per planet, two on outer-moon, none on other moons"`. `"a jump from the moon, anywhere
    on it, at any time, ends on the moon or its planet"` runs for every moon without pads.
  - pickups: the layout test already requires two pickups on every planet and moon; add
    `"no new weapon spots: the sniper rifle only on far, the railgun only on hot"` if not already covered.
- [ ] **Step 2: Run** `node --test tests/system.test.mjs tests/pads.test.mjs tests/pickups.test.mjs`.
  Expected: FAIL (moons and pads missing).
- [ ] **Step 3: Add the bodies, two pads and two pickups per new moon** in `tuning.js`. Sizes 2.5 to 4 m,
  `g`, `reach` (1.75 × radius, as the other bodies), `hold` and orbit numbers chosen so every property holds:
  periods divide CYCLE, no two bodies ever touch, every moon can be stood on, every pad has a 5 s window in
  the first 10 minutes, moon jumps stay home. Pickups: health, fuel or ammo only (no new weapon spots). A
  short throwaway search script is fine; don't commit it unless it is reused.
- [ ] **Step 4: Run the full suite.** Expected: all pass (including comets never within 3 m of any body,
  which now includes the moons; if a comet test fails here, move the moons, since Task 4 re-searches comets
  anyway).
- [ ] **Step 5: Commit** `Three new moons; the giant's outer moon has jump pads`.

### Task 4: Comets at a more even speed

**Files:** Modify `src/sim/system.js` (`ellipse`), `src/tuning.js` (comet orbits). Create
`tools/comet_search.mjs`. Test: `tests/system.test.mjs`.

**Interfaces:** each comet orbit gains `kepler` in [0, 1]: the timing law `M = E - kepler * e * sin E`
(1 is today's Kepler timing, 0 moves evenly in E). Newton's step uses `1 - kepler * e * cos E`, and
`dE = n / (1 - kepler * e * cos E)`.

- [ ] **Step 1: Replace** `"a comet is fast near the sun and slow far out"` with
  `"comets keep a more even speed: fastest at most 2.5x slowest, and near the sun about as fast as before"`:
  for each comet over one period, max speed / min speed ≤ 2.5, and max speed ≥ 0.75 × today's
  (`{ "comet-a": 10.14, "comet-b": 9.16, "comet-c": 3.39, "comet-d": 5.07 }` m/s, measured before this change;
  keep them in the test with that comment).
- [ ] **Step 2: Run** `node --test tests/system.test.mjs`. Expected: FAIL (ratios 4.6 to 10.2 today).
- [ ] **Step 3:** Implement the law in `ellipse`. Write `tools/comet_search.mjs` (Node, imports the sim) that
  searches peri, apo, period (a divisor of CYCLE), phase, inc, node, arg and `kepler` per comet against every
  full-cycle property in `tests/system.test.mjs` and `tests/world.test.mjs` (never within 3 m of a body,
  a close pass every 120 s, riding a lap stays on, hopping off the slow comet lands on heavy or giant, all
  comets inside `VOID_RADIUS` with margin) and prints the best set. One line at its top on how to run it.
- [ ] **Step 4: Put the found numbers in `tuning.js`**, update the comet comments (periods, what each comet
  is for), run the full suite. Expected: all pass.
- [ ] **Step 5: Commit** `Comets move at a more even speed`.

### Task 5: Asteroids in the simulation

**Files:** Create `src/sim/asteroids.js`. Modify `src/tuning.js`, `src/sim/world.js`, `src/sim/weapons.js`,
`src/sim/lag.js`. Test: create `tests/asteroids.test.mjs`.

**Interfaces:**
- Tuning: `ASTEROID = { every: 15, radius: 1.8, speed: [8, 16], tilt: 20, life: 120, blast: { splash: 5,
  damage: 90, knockback: 18, self: 0.5 } }` (s, m, m/s, degrees above or below the orbital plane, s; blast as
  ROCKET's). Starting values; tune to the tests.
- `launchOf(tuning, system, k) -> { id: "rock." + k, pos, vel } | null` (asteroids.js): launch number k ≥ 1 at
  `t = k * every`, from a point on the belt (`BELT` inner/outer/thick, turning with `BELT.period` as drawn)
  chosen by a pure hash of k (the FNV-1a and LCG pattern of `shotRand`), velocity = the belt's own motion
  plus a hashed direction within `tilt` of the plane at a hashed speed in `speed`. Null if that point is
  inside or within `radius` of any body at that time (then nothing launches for k).
- `stepAsteroids(world, dt)`: launches every k whose time has come since the last tick (`world.rocksLaunched`
  counts them), moves each rock with `gravityAt`, then resolves, in this order: a body touched (swept with
  `segmentHit(…, radius)`) explodes the rock there, unless it is the sun, which burns it
  (`{ type: "burn", id }`, no blast); an entity's spheres touched explodes it; beyond `VOID_RADIUS` or older
  than `life` it is dropped silently.
- `world.asteroids = [{ id, pos, vel, age, owner }]`, `owner` null until a shot sets it off.
- `detonate(world, rock, ownerId, lag)`: removes the rock and calls `explode(world, rock.pos, ownerId, lag,
  rock.id, ASTEROID.blast)`. `explode` gains the `spec` parameter (default ROCKET) and sets off any rock within
  `spec.splash + ASTEROID.radius`, owned by the blast's owner, each rock at most once.
- Shots: in `stepProjectiles` a projectile whose segment meets a rock (sphere of `radius`, at the rock's
  position `p.lag` seconds ago via `seenRock`) stops there; a rocket explodes there (which sets the rock off
  through its blast), any other shot detonates the rock with `p.owner`. `rail` does the same for the first
  rock on its line. `record` stores rock positions; `seenRock(world, rock, lag) -> pos`.
- Damage from an owned rock's blast is the owner's (normal `hurt`); from an unowned one `hurt` gets
  `byId = null`, which leaves `lastHitBy` alone, so the existing credit rule decides (spec: like the sun).
- Events: `{ type: "explode", pos, id: rock.id }` (as rockets) and `{ type: "burn", id }`.

- [ ] **Step 1: Write the failing tests** (`tests/asteroids.test.mjs`), each on a bare world (no entities
  unless the test adds them):
  - `"one launch every 15 s: 40 in the first 10 minutes, minus launches that would start inside a body"`.
  - `"the same launch number gives the same rock, on any machine"` (two fresh worlds, identical ids, pos
    and vel at t = 300 s; `world.rand` drawn from in between in one of them changes nothing).
  - `"no launch point is inside or touching a body"` (k = 1 … 2000: `launchOf` is null or clear by `radius`).
  - `"over 30 minutes most rocks fall into the sun, and some hit a planet or moon"`: count `burn` vs explode
    events; at least 5 % of launches hit a planet or moon.
  - `"a rock that lands on a planet explodes like a rocket: a player 2 m away is hurt and thrown"`.
  - `"a pistol bullet sets a rock off, and its blast is the shooter's: a kill from it is theirs"`.
  - `"a railgun ray sets off the first rock on its line"`.
  - `"a rock that hits on its own leaves the credit to whoever hit you last"` (hurt by A within the
    standing rule, then an unowned rock kills: A gets the kill; with no recent hit: a death and no kill).
  - `"chain: a blast sets off a nearby rock, each rock explodes once, and the chain ends"`.
  - `"a rock reaching the sun burns with no blast"`, `"a rock leaving the system is dropped"`.
  - `"a shot at a rock where the shooter saw it hits with lag"` (lag compensation, as for players).
- [ ] **Step 2: Run** `node --test tests/asteroids.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the interfaces; `stepWorld` calls `stepAsteroids` after `stepProjectiles`.
  `createWorld` starts `asteroids: []`, `rocksLaunched: 0`. Solo and server both run it; the browser's
  online view never calls `stepWorld`, so it never launches rocks itself.
- [ ] **Step 4: Run the full suite.** Expected: all pass. Tune `ASTEROID` numbers (speed, tilt) if the
  "some hit a planet" property fails.
- [ ] **Step 5: Commit** `Asteroids fall from the belt and explode where they land`.

### Task 6: Asteroids online

**Files:** Modify `src/net/protocol.js` (PROTOCOL 3, snapshot `rocks`), `src/net/interp.js`,
`src/client/online.js`, `src/sim/weapons.js` (cosmetic rule). Tests: `tests/protocol.test.mjs`,
`tests/interp.test.mjs`, `tests/online.test.mjs`, `tests/game.test.mjs`.

**Interfaces:** snapshot gains `rocks: [{ id, pos, vel, owner }]`. `interp.sample(tick)` returns
`{ entities, shots, rocks }`, rocks lerped like shots. The online view sets `view.asteroids` from it each
frame. In a cosmetic world a projectile that meets a rock is removed there with no blast and no detonation
(the server's `explode` event draws the blast).

- [ ] **Step 1: Write the failing tests:**
  - protocol: `"PROTOCOL is 3"` (the pin test moves); `"a snapshot carries the rocks"`.
  - interp: `"rocks are drawn between snapshots like shots"`.
  - online: `"rocks from snapshots are in the view; the view never launches its own"` (step the view
    through 30 s of snapshots carrying no rocks: `view.asteroids` stays empty);
    `"your bullet stops at a rock on your screen and the rock waits for the server"`.
  - game: `"two players: a rock set off by one player's shot kills the other; scores agree"`;
    `"after everyone leaves, the new game starts with no rocks and launches from k = 1 again"`.
- [ ] **Step 2: Run** those four files. Expected: FAIL.
- [ ] **Step 3: Implement.** Bump `PROTOCOL` to 3 (the hit shape and every rule here change together).
- [ ] **Step 4: Run the full suite, then the two-browser check** against a local server
  (CLAUDE.md commands). Expected: all tests pass; `net_check` prints `OK`.
- [ ] **Step 5: Commit** `Asteroids online: the server decides, browsers draw them between snapshots`.

### Task 7: Drawing asteroids

**Files:** Modify `src/client/render.js`, `src/tuning.js` (looks-only `ROCK_LOOK = { trail: 40, glow: … }`).

- [ ] **Step 1:** Draw each rock in `world.asteroids` as a rough dark rock of `ASTEROID.radius`, glowing
  orange-hot, with a glowing trail of its last `ROCK_LOOK.trail` drawn positions (kept per id in the
  renderer, dropped when the rock goes). Simple shapes; the look round replaces them.
- [ ] **Step 2: Run the page check** with `?debug` and a `?view=` camera on the belt after 20 s (CLAUDE.md
  command). Expected: `OK`, and the screenshot shows at least one rock with a trail.
- [ ] **Step 3: Commit** `Asteroids glow and leave a trail`.

### Task 8: O and P hide the orbit lines and pad cues

**Files:** Create `src/client/settings.js`. Modify `src/client/main.js` (keys), `src/client/render.js`
(visibility), `src/client/hud.js` (controls line). Test: create `tests/settings.test.mjs`.

**Interfaces:** `createSettings(storage) -> { get(name) -> bool, toggle(name) -> bool }` for names
`"orbits"` and `"cues"`, both true by default, saved as JSON under `"planet-arena.settings"`. `storage` is
`localStorage` or a test double; every access is in try/catch. The sounds round adds `"mute"` and `"hits"`.
Renderer: `render.setShown({ orbits, cues })` hides the orbit rings, and the pad cue path and pad lights.

- [ ] **Step 1: Write the failing tests:** `"both shown by default"`, `"toggle flips and is remembered by a
  new settings object on the same storage"`, `"a throwing or missing storage gives the defaults and toggles in
  memory without throwing"`, `"a corrupt stored value gives the defaults"`.
- [ ] **Step 2: Run** `node --test tests/settings.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** O and P work while playing (pointer locked) and on the start screen. The
  controls line ends with `· O orbits · P pad cues`.
- [ ] **Step 4: Run the full suite and the page check.** Expected: all pass, `OK`.
- [ ] **Step 5: Commit** `O and P show or hide orbit lines and pad cues`.

### Task 9: Docs and the last checks

**Files:** `README.md`, `CLAUDE.md` (controls), `docs/superpowers/specs/2026-10-25-planet-arena-design.md`
(one note pointing to the gameplay round spec for the adrift change).

- [ ] **Step 1:** Update controls (O, P), describe asteroids and moons in one or two lines where the README
  lists what is in the game, and note that a rules change bumps `PROTOCOL` (now 3) and needs
  `fly deploy --ha=false`.
- [ ] **Step 2: Run** the full suite, the page check (solo) and the two-browser check (local server).
  Expected: all pass, `OK`, `OK`.
- [ ] **Step 3: Commit** `Docs for the gameplay round`.

## After the plan

The owner deploys: push to `main` (page) and `fly deploy --ha=false` (server). The game is closed now
(scaled to 0); a deploy creates a machine, so scale back to 0 afterwards if the owner wants it closed.
