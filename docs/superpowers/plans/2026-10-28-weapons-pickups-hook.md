# Weapons, Pickups and the Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six weapons with ammo, pickups (health, weapons, ammo, booster fuel) on every planet and the moon,
and a hook that catches bodies within 25 m and pulls you to them; you start with the pistol only.

**Architecture:** Weapons become one table in `src/tuning.js`; `fire()` handles bullets (with spread and
pellets), rockets and the railgun's instant ray, using a seeded random generator on the world so the sim
stays deterministic. Pickups (`src/sim/pickups.js`) and the hook (`src/sim/hook.js`) are new sim modules
called from `stepWorld`. The client gains keys 1 to 6, the hook on right mouse, zoom on Shift, a richer HUD
and drawings for pickups, the rope, the beam and the new weapons.

**Tech Stack:** plain ES modules, three@0.160.0 from the import map, Node 22 test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-weapons-pickups-hook-design.md` (extends
`2026-10-25-planet-arena-design.md` and `2026-10-27-comets-and-rings-design.md`).

## Global Constraints

- Plain ES modules, three@0.160.0 from the import map; no bundler, no npm packages in the page.
- Every gameplay number lives in `src/tuning.js`. When a property test fails, change the numbers, never the test's property.
- `src/sim/` imports nothing from three.js or the DOM; the sim stays deterministic (no `Math.random` in `src/sim/`).
- Fixed tick 1/60 s; orbits scripted from the clock.
- You start, and respawn, with the pistol only; the pistol never runs out.
- Hook: range 25 m; catches planets, moons and comets, not the sun or players; the rope never snaps; letting go keeps your speed.
- Shotgun push hits the target only, never the shooter.
- Docs and comments: brief, explain why; no em dashes.
- Tests: `node --test 'tests/*.test.mjs'`. Page check (server on 8100): `NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/page_check.cjs "http://localhost:8100/?debug" shots/start.png` prints `OK`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- Pressing a weapon key for a weapon you don't hold, or firing with no ammo: nothing breaks; an empty weapon hands you the pistol (Task 1 test).
- Hooking your own planet underfoot, the sun, or empty space: no catch, no stuck state, no NaN (Task 4 test).
- Dying while hooked: the rope is gone after respawn (Task 4 test).
- Overfilled fuel, then landing: standing never lowers it; it only refills up to the usual maximum once spent (Task 3 test).
- Tunnelling: a sniper bullet at 600 m/s still hits a 0.5 m target and a thin planet chord (Task 2 test).

## Numbers decided here (all in `src/tuning.js`; tune after playtests)

| Weapon | Type | Speed m/s | Damage | Cooldown s | Spread ° (half-angle) | Other | Ammo: weapon pickup / box / max |
|---|---|---|---|---|---|---|---|
| pistol | bullet | 120 | 10 | 0.35 | 0 | unlimited ammo | none |
| shotgun | bullet | 120 | 10 per pellet | 0.9 | 7 | 10 pellets, gone after 35 m, push 0.8 m/s per pellet | 8 / 8 / 24 |
| rocket | rocket | 30 | 90 (splash) | 0.9 | 0 | existing splash, knockback, self 0.5 | 5 / 5 / 15 |
| minigun | bullet | 120 | 6 | 0.08 | 1.2 | | 100 / 80 / 300 |
| sniper | bullet | 600 | 75 | 1.5 | 0 | zoom 4x | 5 / 5 / 15 |
| railgun | ray | instant | 90 | 1.5 | 0 | range 800 m, ignores gravity, beam shown 0.5 s (`showFor`) | 5 / 5 / 10 |

`HOOK = { range: 25, pull: 30, speed: 15, cooldown: 0.5 }`: pull is m/s² towards the anchor, applied
only while closing speed is below `speed`; cooldown counts from letting go (or from a miss).

`PICKUP = { touch: 1.2, health: 25, fuelMax: 2, respawn: { health: 20, ammo: 15, weapon: 30, fuel: 40 } }`:
`fuelMax` is a multiple of `BOOST.fuel`.

---

### Task 1: Weapon table, inventory and ammo

**Files:**
- Modify: `src/tuning.js`, `src/sim/entity.js` (createEntity, NO_INPUT), `src/sim/weapons.js` (fire), `src/sim/world.js` (weapon select)
- Test: `tests/weapons.test.mjs`

**Interfaces:**
- Produces: `WEAPONS` (keyed by name, the table above: `{ type, speed, damage, cooldown, spread, pellets?, range?, push?, zoom?, ammo: { pickup, box, max } | null }`), `WEAPON_ORDER = ["pistol", "shotgun", "rocket", "minigun", "sniper", "railgun"]`; `PISTOL` and `ROCKET` stay exported as `WEAPONS.pistol` and `WEAPONS.rocket` so existing code and tests keep working.
- Produces: entities carry `weapons: ["pistol"]` and `ammo: {}` (a missing key is 0; the pistol is never counted). `NO_INPUT` gains `hook: false, zoom: false`.
- Produces: `fire(world, e) -> boolean` spends one ammo per shot for weapons with `ammo`, and when that weapon is empty afterwards sets `e.weapon = "pistol"`.

- [ ] **Step 1: Write the failing tests** in `tests/weapons.test.mjs`

```js
test("you start with the pistol only, and a key for a weapon you don't hold does nothing", () => {
  // createWorld: player.weapons deep-equals ["pistol"]; stepWorld with { weapon: "rocket" } leaves weapon "pistol".
});
test("a held weapon spends one ammo per shot, and an empty one hands you the pistol", () => {
  // Give the player the rocket with ammo 2; fire twice (stepping past the cooldown): ammo 1 then 0,
  // weapon "pistol" after the second; firing again shoots a pistol bullet.
});
test("the pistol never runs out", () => {
  // 50 pistol shots: all fired, e.ammo.pistol undefined.
});
test("respawning gives the pistol only", () => {
  // Player holds rocket + shotgun with ammo, dies (sun), respawns: weapons ["pistol"], ammo {}.
});
```

Fill each body; the comments are the assertions. Existing rocket tests that give the player the rocket
must now also grant it (`p.weapons.push("rocket"); p.ammo.rocket = 15`).

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/weapons.test.mjs`. Expected: FAIL (`weapons` undefined, rocket selectable).

- [ ] **Step 3: Implement** the tuning table, entity fields, select-only-held in `stepWorld`, ammo in `fire`.

- [ ] **Step 4: Run everything**

Run: `node --test 'tests/*.test.mjs'`. Expected: all pass.

- [ ] **Step 5: Commit** `"Weapon table, inventory and ammo; start with the pistol only"`

---

### Task 2: Shotgun, minigun, sniper rifle and railgun

**Files:**
- Modify: `src/sim/weapons.js`, `src/sim/world.js` (`world.rand`, `world.beams`), `tests/helpers.mjs` (`makeWorld` gets `rand`)
- Test: `tests/weapons.test.mjs`

**Interfaces:**
- Consumes: Task 1's `WEAPONS`, inventory and `fire`.
- Produces: `world.rand(): number in [0, 1)`, a seeded generator made in `createWorld` (seed 1), the only randomness in the sim. `world.beams: [{ from, to, age }]`, aged and dropped like explosions after `WEAPONS.railgun.showFor` (0.5 s). Events `{ type: "beam", from, to }`.
- Produces: bullets carry `range` (metres left) when the weapon has one; they vanish when it runs out.

Spread: each bullet's direction is the view direction turned by an angle up to `spread`, uniform over the
cone's disc (`theta = spread * sqrt(rand)`, around the view at angle `2 pi rand`). Pellet push: a pellet hit
adds `push` m/s to the target along the pellet's direction, ungrounding it; never to the shooter. The
railgun is a straight segment from the eye along the view, `range` long: the nearest body or entity hit
(using `segmentHit` and `segmentHitsSphere`) takes the damage; no gravity, no projectile.

- [ ] **Step 1: Write the failing tests**

```js
test("the railgun hits instantly along a straight line, where a bullet would bend", () => {
  // Shooter 1 m above the heavy planet's surface, target 60 m away along the view, near the surface:
  // one railgun shot damages it in the same tick by 90; a beam event from the eye to the hit point.
});
test("shotgun pellets push the target, not the shooter, and vanish beyond 35 m", () => {
  // Target 3 m ahead in open space: after one shot its velocity changed along the shot, the shooter's
  // velocity unchanged (both floating, compared with a no-shot twin). A target at 40 m takes no damage.
});
test("a 600 m/s sniper bullet still hits a small target and doesn't pass through a planet's edge", () => {
  // Target 100 m away in open space: one shot, 75 damage. A shot along a chord 0.3 m inside the tiny
  // planet's surface hits the planet.
});
test("the same seed fires the same spread", () => {
  // Two worlds, same setup: minigun 20 shots; projectile velocities identical.
});
test("no weapon is simply better: each of shotgun, minigun and railgun is strongest at some range", () => {
  // Shooter and a target held still in open space (far from bodies), infinite ammo for the test.
  // Damage per second over 10 s at 5, 25 and 80 m, for pistol, shotgun, minigun, sniper, railgun:
  // the shotgun is best at 5 m, the minigun at 25 m, the railgun or sniper at 80 m.
});
```

- [ ] **Step 2: Run them to see them fail.** `node --test tests/weapons.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** spread, pellets with range and push, the sniper's speed, the railgun ray and beams.
- [ ] **Step 4: Run everything.** `node --test 'tests/*.test.mjs'`. Expected: all pass. If the range test fails, change the table's numbers, not the test.
- [ ] **Step 5: Commit** `"Shotgun, minigun, sniper rifle and railgun"`

---

### Task 3: Pickups

**Files:**
- Create: `src/sim/pickups.js`
- Modify: `src/tuning.js` (`PICKUP`, `PICKUPS`), `src/sim/world.js` (call `stepPickups`), `src/sim/entity.js` (fuel refill)
- Test: `tests/pickups.test.mjs`

**Interfaces:**
- Produces: `PICKUPS = [{ id, body, dir, kind: "health" | "fuel" | "weapon" | "ammo", weapon? }]`, `dir` built with the existing `heading(a, el)`.
- Produces: `pickupPos(world, pickup, poses) -> vec3` (on the surface along `dir`), `pickupReady(world, pickup) -> boolean`, `stepPickups(world)`; `world.pickups = { [id]: { readyAt } }` (ready at 0); event `{ type: "pickup", id, pickupId }`.

Rules: only entities of kind `"player"` take pickups, when alive and with feet within `PICKUP.touch`, and
only if it helps: health below maximum; fuel below `BOOST.fuel * PICKUP.fuelMax` (sets it to that); a
weapon not held, or held with ammo below max (adds `ammo.pickup`; a new weapon becomes the one in hand);
ammo below max for that weapon (adds `ammo.box`, held or not). Ground refill in `stepEntity` becomes
"raise towards `BOOST.fuel`, never lower".

Starting layout (adjust the angles if a layout test fails):

| Body | Pickups (kind, `heading(a, el)`) |
|---|---|
| hot | railgun weapon (0, 50), health (120, -45), fuel (240, 45) |
| tiny | shotgun weapon (0, 50), health (180, -50), shotgun ammo (90, -50) |
| mid | minigun weapon (90, 45), health (270, -45), health (300, 60), minigun ammo (150, -40), shotgun ammo (200, 40) |
| heavy | rocket weapon (60, 40), health (200, -40), rocket ammo (300, 35), minigun ammo (0, -35) |
| moon | sniper weapon (0, 40), sniper ammo (180, -40) |
| giant | minigun weapon (30, 40), health (150, -40), health (270, 50), fuel (90, -50), rocket ammo (210, 35), sniper ammo (330, -35), railgun ammo (0, 60) |

- [ ] **Step 1: Write the failing tests** in `tests/pickups.test.mjs`

```js
test("layout: every planet and the moon have at least two pickups; each weapon but the pistol can be found; the sniper rifle and railgun only on the hot planet or the moon", () => {});
test("layout: pickups sit on the surface, at least 4 m from every pad and 3 m from each other", () => {});
test("health heals 25 up to the maximum, and isn't taken at full health", () => {});
test("a weapon pickup gives the weapon with 'pickup' ammo and puts it in hand; held and full, it stays", () => {});
test("an ammo box adds 'box' ammo up to max, for a weapon you don't hold too", () => {});
test("fuel fills to twice the tank; standing doesn't lower it; spent, it refills only to the usual tank", () => {});
test("a taken pickup comes back after its respawn time, not before", () => {});
test("the dummy never takes pickups", () => {});
```

Each test sets the player's feet on the pickup with `createEntity` + `standOn`, steps one `stepWorld`,
and checks the entity, `pickupReady` and the `pickup` event. Pad-free worlds where pads aren't the point.

- [ ] **Step 2: Run them to see them fail.** `node --test tests/pickups.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `pickups.js`, the layout, the call in `stepWorld` after the entity loop, the refill rule.
- [ ] **Step 4: Run everything.** Expected: all pass.
- [ ] **Step 5: Commit** `"Pickups: health, weapons, ammo and extra booster fuel"`

---

### Task 4: The hook

**Files:**
- Create: `src/sim/hook.js`
- Modify: `src/tuning.js` (`HOOK`), `src/sim/entity.js` (fields), `src/sim/world.js` (call it each tick), `src/sim/world.js` `die` (drop the rope)
- Test: `tests/hook.test.mjs`

**Interfaces:**
- Consumes: `input.hook` (held) from Task 1's `NO_INPUT`.
- Produces: entity fields `hook: null | { body, offset, len }` (anchor = body position + offset, since bodies don't spin) and `hookCooldown`; `hookAnchor(world, e) -> vec3`; `stepHook(world, e, held, dt)`, called in `stepWorld` right after `stepEntity`.

Behaviour of `stepHook`:
- **Fire** on a fresh hold with no rope and `hookCooldown <= 0`: segment from the eye along the view,
  `HOOK.range` long, against bodies other than the sun (`segmentHit`). A hit makes the rope with
  `len` = eye-to-hit distance; a miss starts the cooldown. Hitting the body you stand on releases at once.
- **Hold**: unground if standing on another body; add `HOOK.pull * dt` towards the anchor while the
  closing speed (relative to the anchor body's velocity) is below `HOOK.speed`; gravity is untouched.
  Then the rope: `len = min(len, distance)`; if the hit centre is farther than `len`, move it back onto that
  sphere and remove the outward relative velocity, so a body moving away drags you (it never snaps).
- **Land**: grounded on the anchor body releases the rope.
- **Let go** (button up): rope gone, velocity untouched, `hookCooldown = HOOK.cooldown`.
- **Death** drops the rope.

- [ ] **Step 1: Write the failing tests** in `tests/hook.test.mjs`

```js
test("the hook catches a body within 25 m and misses beyond; never the sun, never your own ground", () => {});
test("from the heavy planet, hooking the moon and holding lands you on the moon", () => {
  // At a time when the moon's surface is within 25 m of a point on the heavy planet: stand there, look
  // at the moon, hold the hook: within 5 s groundId === "moon", alive.
});
test("hook a passing comet in flight and you end up riding it", () => {
  // Place an entity 20 m from comet-a, moving past it at 15 m/s relative; hook it and hold: within 6 s
  // groundId === "comet-a".
});
test("the rope never snaps: a body moving away drags you along", () => {
  // Hook comet-a from 20 m, held, while it moves away: distance to the anchor never exceeds the length at
  // the catch (plus 1e-6) over 3 s.
});
test("letting go keeps your speed, and the hook waits 0.5 s from then", () => {});
test("a rocket blast doesn't break the rope, and dying drops it", () => {});
test("hooking empty space or the sun leaves no rope and no NaN", () => {});
```

- [ ] **Step 2: Run them to see them fail.** `node --test tests/hook.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `hook.js` and its call in `stepWorld`.
- [ ] **Step 4: Run everything.** Expected: all pass.
- [ ] **Step 5: Commit** `"The hook: catch a body within 25 m and pull yourself to it"`

---

### Task 5: Controls, HUD and drawing

**Files:**
- Modify: `src/client/input.js`, `src/client/main.js`, `src/client/hud.js`, `src/client/render.js`, `index.html` (HUD CSS), `README.md`, `CLAUDE.md` (controls)
- Test: `tests/input.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 4 (`WEAPON_ORDER`, `e.weapons`, `e.ammo`, `world.beams`, `world.pickups`, `pickupPos`, `pickupReady`, `hookAnchor`, `WEAPONS.sniper.zoom`).
- Produces: `input.sync(current, held)` (wheel cycles only held weapons); input records with `hook` (right mouse held) and `zoom` (Shift held).

- [ ] **Step 1: Write the failing tests** in `tests/input.test.mjs`

```js
test("keys 1 to 6 pick weapons in WEAPON_ORDER", () => {});
test("the wheel cycles only the weapons you hold", () => {});
test("right mouse held is the hook; Shift held is zoom; blur clears both", () => {});
```

- [ ] **Step 2: Run them to see them fail.** `node --test tests/input.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the client**
  - `main.js`: right button to `onButton(2, ...)`; suppress the context menu on the canvas; `sync(weapon, weapons)`.
  - HUD: weapon name with ammo ("Rocket launcher 5"); a row 1 to 6 with held weapons lit; the fuel bar shows fuel above the usual tank in a second colour; the crosshair shows a ring when a hookable body is within 25 m along the view.
  - Render: pickups float and turn slowly above their spots (health white with a red cross, fuel orange, weapons as small models, ammo as boxes in their weapon's colour), a faint wireframe while waiting to return; the rope as a line from the hand to `hookAnchor`; railgun beams fading over 0.5 s; bullets and pellets as small bright tracers; simple view models for the four new weapons; while the sniper is in hand and zoom held, field of view divided by `zoom` and mouse turn scaled down by it.
  - README and CLAUDE.md: controls (1 to 6, wheel, right mouse hook, Shift zoom), weapons and pickups.
- [ ] **Step 4: Run tests and look at it**: `node --test 'tests/*.test.mjs'` all pass; page check `OK` on `?debug` and on `?debug&view=` pointed at a pickup on the mid planet (`pickupPos` at the page's start time); open both screenshots.
- [ ] **Step 5: Commit** `"Controls, HUD and drawings for weapons, pickups and the hook"`
