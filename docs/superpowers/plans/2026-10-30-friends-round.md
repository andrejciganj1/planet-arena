# Friends Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the backlog except destructible planets, then a performance and tidy-up pass, then ship to the online server for the owner's friends test.

**Architecture:**
- **Gameplay in the sim.** The two gameplay changes, the flying hook and the flare death label, live in `src/sim/` with tests.
- **Looks.** Everything else is drawing and HUD work in `src/client/`. Each look gets a pure, three-free function in a `look/*pose.js` module (node-testable, as `flarepose.js`, `proppose.js` and `alienpose.js` already are) plus the three.js drawing that reads it.
- **Release.** Performance comes last, measured before and after. Then merge, push and deploy.

**Tech Stack:** plain ES modules, three@0.160.0 (import map), Web Audio, Blender 4 (scripted models), `node --test`, Playwright checks through `npx`, `fly` CLI.

**Spec:** `docs/superpowers/specs/2026-10-30-friends-round-design.md`

## Global Constraints

- Plain ES modules, three@0.160.0 from the import map; no bundler, no npm dependencies in the page.
- Every gameplay number lives in `src/tuning.js`, and looks-only numbers in `LOOK`. When a property test fails, change the numbers, never the test's property.
- `src/sim/` has no three.js or DOM; `src/net/` has no DOM or Node-only APIs.
- Own assets only; Blender models made by script and deterministic. No em dashes; brief comments that explain why.
- The page, net, look and sound checks pass. The look check stays at 60 fps at every level, and the throttled run settles. That is the baseline before this round.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `friends-round`.
- Shared look randomness: new looks use their own `rng(seed)`, never the renderer's shared `rand` stream. Drawing more from it would change every body made after.

## Review Focus

1. **A hook fired while standing, aimed at the ground you stand on.** It must miss, not catch on the first tick, as the instant hook does today. Tested in Task 2.
2. **A hook in flight when its owner dies or respawns.** It must vanish, never catch for a dead player. Tested in Task 2.
3. **The third-person camera in a narrow spot,** for example pressed against a moon. It must never go inside a body or flip. Tested in Task 4 (`thirdCamera`).
4. **The third-person crosshair against a near player or wall.** It shows the true impact point. Tested in Task 4 (`aimPoint`).
5. **Many explosions at once,** such as an asteroid shower or rocket spam. The pool is bounded, so a burst can't stall a frame. Tested in Task 6 (pool cap).

---

### Task 1: Flare fixes

**Files:**
- Modify: `src/sim/flares.js`, `src/sim/world.js`
- Modify: `src/client/sounds.js`, `src/client/look/flarepose.js`, `src/client/render.js`, `src/tuning.js`
- Test: `tests/flares.test.mjs`, `tests/sounds.test.mjs`, `tests/look.test.mjs`

**Interfaces:**
- `stepFlare` sets `e.flareTick` only when its own damage took health from above 0 to 0 or below that tick.
- The director remembers the last flare `k` whose alarm, voice and roar it played, and plays each once per `k`.
- `flareView(t).burn`:
  - rises over `LOOK.flare.rise`;
  - is 1 until `endAt`;
  - then falls to 0 over `LOOK.flare.dim` (0.5 s) into the fade.
- The sun light's base intensity becomes `LOOK.sun.light = 7`, used where the light is made and where the flare scales it.

- [ ] **Step 1: Write the failing tests:**
  - `"a rocket kill in a burn is a rocket kill"`: a lit player on Hot in a burn with health 5 is hit by an `explode` at their feet in the same tick. The death cause is `"damage"`.
  - `"a clock that jumps back over a warning doesn't sound it again"`: frames across `warnAt`, then one frame with `w.t` set 2 s before `warnAt` (a gap), then frames across `warnAt` again. `flareAlarm` totals 1.
  - `"the sun blazes until the burn ends, then dims over half a second"`: `flareView(endAt - 0.05).burn === 1`, `flareView(endAt + 0.25).burn` is between 0.3 and 0.7, and `flareView(endAt + 0.6).burn === 0`.
- [ ] **Step 2: Run** `node --test tests/flares.test.mjs tests/sounds.test.mjs tests/look.test.mjs`. Expected: the three new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test 'tests/*.test.mjs'`. Expected: all pass.
- [ ] **Step 5: Commit**: "Flare fixes: rocket kills keep their name, warnings sound once, the sun blazes to the end".

### Task 2: The hook flies (sim)

**Files:**
- Modify: `src/sim/hook.js`, `src/sim/world.js` (clear on death and respawn), `src/tuning.js` (`HOOK.fly: 50`), `src/net/protocol.js` (`PROTOCOL = 6`)
- Test: `tests/hook.test.mjs`, `tests/protocol.test.mjs`

**Interfaces:**
- Produces: `e.hookShot = { pos, dir, gone } | null`, the hook in flight.
  - `pos` is where it is now, `dir` is the unit direction fixed at firing, and `gone` is the metres flown.
  - `e.hook` keeps today's meaning (caught: `{ body, offset, len }`) and shape, so the pull, the HUD and the poses are unchanged.
  - Exactly one of the two, or neither, is set.
- Firing (a fresh hold, cooldown over) sets `hookShot` at the eye along `viewDir(e)`.
- Each tick, `stepHook` moves it `min(HOOK.fly * dt, HOOK.range - gone)` and tests that segment with `segmentHit`. The sun or the ground body you stand on is a miss. Any other body turns it into `e.hook` exactly as `fireHook` did.
- Reaching `range`, or releasing the button, clears it and starts `HOOK.cooldown`.
- `die` and `spawn` clear `hookShot` and `hook`.
- `PROTOCOL` becomes 6 (the test says hook flight changed the rules).

- [ ] **Step 1: Write the failing tests** in `tests/hook.test.mjs`, following its existing setup:
  - `"the hook flies at 50 m/s: a body 10 m off is caught 0.2 s after firing"`: catch tick within 1 tick of 0.2 s.
  - `"at full range it takes 0.5 s and misses"`: aimed at empty space, `hookShot` lives for 0.5 s ± 1 tick, then is null, and `hookCooldown > 0`.
  - `"letting go in flight cancels and starts the cooldown"`.
  - `"aimed at your own ground or the sun, it misses"` (Review Focus 1).
  - `"a body that moves out of the hook's line is missed"`: aim at a point a moon will have left when the hook arrives. Find such a moment by searching the clock for the moon crossing.
  - `"a dead player's hook in flight is gone, and a respawn starts with none"` (Review Focus 2).
  - Change existing hook tests that assume an instant catch to step until caught: their properties (pull, rope, release) stay.
  - `PROTOCOL is 6`.
- [ ] **Step 2: Run** `node --test tests/hook.test.mjs tests/protocol.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test 'tests/*.test.mjs'`. Expected: all pass. Prediction (`src/net/predict.js`) runs `stepPlayer`, so it predicts the flight without changes: check that `tests/predict.test.mjs` and `tests/online.test.mjs` pass.
- [ ] **Step 5: Commit**: "The hook flies out at 50 m/s and can miss; PROTOCOL 6".

### Task 3: The hook's look and sound

**Files:**
- Modify: `tools/blender/props.py` (a `hook` object: shank, ring, three prongs as separate children `prong_0..2` pivoting at the shank's foot), `assets/models/props.glb` (rebuilt)
- Modify: `src/client/look/proppose.js` (pure hook pose), `src/client/look/props.js` (hook drawing, dust puff), `src/client/render.js` (every entity's hook, shot and rope; reel back), `src/client/sounds.js` and `src/client/synth.js` (`hookFire` on `hookShot` appearing; new one-shot `hookCatch` at the anchor), `tools/sound_check.cjs` if needed
- Test: `tests/look.test.mjs`, `tests/sounds.test.mjs`, `tests/audio.test.mjs` (sound list)

**Interfaces:**
- `hookPose(state, since)` in `proppose.js`, with `state` one of `"flying"`, `"caught"` or `"reeling"`. It returns `{ open: 0..1 prong spread, spin: rad }`.
  - Flying: open 0, spin at `LOOK.props.hook.spin`.
  - Caught: open eases 0 to 1 over `LOOK.props.hook.snap` (0.2 s).
  - Reeling: open 1 to 0 over the reel time.
- The renderer:
  - keeps per entity the last caught anchor and a reel start, so a release reels the hook back to the hand over `LOOK.props.hook.reel` (0.2 s);
  - starts the rope at the figure's hand for others and below the eye for you, as now;
  - spawns a dust puff in the caught body's surface colour on a catch.

- [ ] **Step 1: Write the failing tests:**
  - `"the hook opens as it catches and folds as it reels back"`: the `hookPose` values at 0, `snap/2` and `snap` for `"caught"`, and the reverse for `"reeling"`.
  - `"firing the hook thwips, catching clanks at the anchor"`: the director sees `hookShot` appear (`hookFire` once), then `hook` appear (`hookCatch` once, `pos` at the anchor).
  - The sound list includes `hookCatch`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Model.** Build the hook in `props.py`, about 0.5 m long, in metal with the accent colour. Rebuild `props.glb` with the command in `CLAUDE.md`. Running it twice gives identical bytes.
- [ ] **Step 4: Implement** the drawing, the puff, the reel and the clank recipe (a short metallic strike: two inharmonic partials and a click).
- [ ] **Step 5: Run** all tests, the sound check and the look check with a new view `hook-caught` (a figure on Mid hooked onto Mid's moon, close). Expected: `OK`. Read the screenshot.
- [ ] **Step 6: Commit**: "A real grappling hook: it flies spinning, snaps open on the catch and reels back".

### Task 4: Third-person view

**Files:**
- Create: `src/client/look/camerapose.js` (pure)
- Modify: `src/client/settings.js` (`KeyV: "third"`, default false, label "Third person"), `src/client/render.js`, `src/client/hud.js` (crosshair at a screen point; flames only in first person), `src/client/main.js`, `index.html` (controls line), `README.md`, `CLAUDE.md` (controls)
- Test: `tests/look.test.mjs`, `tests/settings.test.mjs`, `tests/hud.test.mjs`

**Interfaces:**
- `thirdCamera(eye, dir, up, system, poses, cfg = LOOK.third)` returns the camera position.
  - The target is `eye - dir * cfg.back + right * cfg.side + up * cfg.lift`, with `back: 3.5`, `side: 0.7`, `lift: 0.4`.
  - If `segmentHit(system, poses, eye, target, cfg.pad)` meets a body, the camera sits at that hit point pulled `cfg.pad` (0.3 m) back towards the eye.
- `aimPoint(world, p, eye, dir, range = 300)` returns the first hit along the eye ray, a body via `segmentHit` or a player hit sphere via `segmentHitsPlayer`, else `eye + dir * range`.
- The renderer in third person (`settings.get("third")` and `zoom === 1`):
  - places the camera with `thirdCamera`, looking along `dir`;
  - draws your figure (the same path as others, your interpolated `mine()` pose);
  - hides the holder (first-person arm and gun);
  - starts your shots, beam and rope at the figure's gun and hand;
  - returns the crosshair's screen point, the projection of `aimPoint`, from `renderer.crosshair()`.
- `hud.update` places the crosshair there; in first person it is the centre, as now.

- [ ] **Step 1: Write the failing tests:**
  - `"the third-person camera sits back, right and up of the eye"`: in open space, the exact offset.
  - `"it never goes inside a body"`: against Mid's moon, with the eye 0.5 m off the surface and looking away so the target would be inside it. The returned point is outside every body by at least 0.2 m, and on the eye's side (Review Focus 3).
  - `"the third-person crosshair is where the shot lands"`: a player 5 m ahead and slightly off-axis is the aim point, and so is a body 40 m ahead (Review Focus 4).
  - `settings`: `KeyV` toggles `third`, which defaults to off.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Then run the look check with new views `third-person` (your figure on Mid by day, with a rocket launcher) and `third-person-tight` (pressed against the moon). Expected: `OK`, your figure visible, and the crosshair drawn on the aim point. Read both screenshots.
- [ ] **Step 5: Commit**: "Third-person view on V: over the shoulder, the crosshair where the shot lands".

### Task 5: Sun distance on the HUD

**Files:**
- Modify: `src/client/look/flarepose.js` (`sunReadout`), `src/client/hud.js`, `index.html`
- Test: `tests/hud.test.mjs`

**Interfaces:**
- `sunReadout(world, e)` returns `{ text: "Sun 123 m", near }`.
  - The distance runs from `hitCentre(e)` to the sun's centre, rounded.
  - `near` is true when the distance is below `FLARE.reach`.
- It is shown beside the booster bar, in the flare's orange when `near`.

- [ ] **Step 1: Write the failing test** `"the sun readout gives whole metres and turns orange inside the flare's reach"` at 46.4 m (`"Sun 46 m"`, near), 149.6 m (`"Sun 150 m"`, near, because 149.6 < 150) and 151 m (not near).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests and the page check. Expected: pass, `OK`.
- [ ] **Step 5: Commit**: "The HUD shows your distance to the sun, orange where a flare can reach".

### Task 6: Better explosions

**Files:**
- Create: `src/client/look/blastpose.js` (pure), `src/client/look/blast.js` (three.js)
- Modify: `src/client/render.js` (use the new pool instead of the sphere), `src/client/look/weapons.js` (drop `blast`), `src/tuning.js` (`LOOK.blast`)
- Test: `tests/look.test.mjs`

**Interfaces:**
- `blastLook(age, size, cfg = LOOK.blast)` returns `{ flash, fire, fireSize, smoke, smokeSize, ring, ringSize, sparks, light }`. Each value is 0..1, or metres for sizes.
  - The flash peaks at 0 and is gone by `cfg.flash` (0.12 s).
  - The fire swells to `size` by 0.25 s, then darkens into smoke, which rises and fades by `cfg.life` (1.6 s).
  - The ring runs out to `1.6 * size` by 0.35 s.
  - The sparks fly for 0.6 s.
  - The light follows the flash and the fire.
  - At `ROCKET.showFor` the fire has reached `size`, so blasts still read their reach.
- `blast.js` keeps a pool of at most `cfg.max` (12). The oldest is reused when full.
  - Each blast is a noisy fire sphere (shader, additive, darkening to normal-blended smoke), a ring, sparks (Points), and the flash as a sprite.
  - One shared PointLight, always in the scene (adding and removing lights recompiles shaders), takes the brightest current blast.
  - At quality level 0: no sparks and no light.

- [ ] **Step 1: Write the failing tests:**
  - `"a blast flashes, swells to its size, turns to smoke and is gone by its life"`: values at 0, 0.1, 0.25, 0.8 and 1.7 s.
  - `"blasts reuse the oldest of a fixed pool"`: test a pure `pickSlot(ages, max)` from `blastpose.js`. 13 blasts use 12 slots (Review Focus 5).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests. Then run the look check with a new view `explosion` (a rocket blast on Mid's ground, frozen 0.2 s in; seed it as the `asteroid` view seeds its rock). Read the screenshot. The look check's frame times must stay at 60 fps.
- [ ] **Step 5: Commit**: "Explosions: a flash, rolling fire into smoke, a shock ring, sparks and a glow".

### Task 7: The Milky Way

**Files:**
- Modify: `src/client/look/sky.js` (a band in the painting shader), `src/tuning.js` (`LOOK.sky.milky`)
- Test: `tests/look.test.mjs`

**Interfaces:**
- `LOOK.sky.milky = { pole: [...], width, core: [...], strength, dust }`.
  - `pole` is the band's axis, tilted about 60° from the planets' plane normal.
  - `core` is the direction of its brighter side.
- The shader adds the band's glow, fine stars and dust lanes (noise) to the cube map. The pure helper `milkyBand(dir, cfg)` in `skycheck.js` gives 0..1 across the band, for the test.

- [ ] **Step 1: Write the failing test** `"the Milky Way is a band right round the sky, brightest along its middle"`: `milkyBand` is near 1 on the band's great circle, near 0 at its pole, and is brighter towards `core` than opposite it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The GLSL mirrors `milkyBand`.
- [ ] **Step 4: Run** all tests, then the look check (full: the night contrast views must pass). Read `sky.png` and two night views.
- [ ] **Step 5: Commit**: "The Milky Way across the sky".

### Task 8: The outer ring

**Files:**
- Modify: `src/client/look/proppose.js` (`beltRocks(rand, cfg)` pure layout, used by both rings), `src/client/look/props.js` (`asteroidBelt(rand, cfg = BELT)` builds from `beltRocks`), `src/client/render.js` (outer ring with `rng(LOOK.outerRing.seed)`), `src/tuning.js` (`LOOK.outerRing = { inner: 680, outer: 740, thick: 30, rocks: 700, size: [2, 8], period: 2400, seed: 31, from: 1 }`, where `from` is the lowest quality level drawing it)
- Test: `tests/look.test.mjs`

- [ ] **Step 1: Write the failing test** `"the outer ring is a wide band of big rocks at 680 to 740 m, beyond the void"`: every rock from `beltRocks(rng(31), LOOK.outerRing)` lies within the radius and height bounds, sizes lie in [2, 8], and `inner > VOID_RADIUS`. The belt's layout from the shared stream is unchanged: the same first rock as before the refactor, pinned by value.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests, then the look check. Add a view `outer-ring` from Far's orbit looking out. Read it. Check the frame times.
- [ ] **Step 5: Commit**: "A wide outer ring of big asteroids at 700 m, scenery beyond the void".

### Task 9: Performance and tidy-up

**Files:** as the measurements say. No behaviour changes.

- [ ] **Step 1: Measure before.**
  - Add `tools/bench.mjs`. It builds an online-style world with 8 players, all firing rockets and hooking, and runs 3600 `stepWorld` ticks through a flare and asteroid showers. It prints ms per tick, average and 99th percentile.
  - Run the look check for the per-level `work` ms.
  - Profile one frame of the busy `?debug` page with Playwright's CDP profiler. List the top 10 self-time functions.
  - Record all of it in the ledger.
- [ ] **Step 2: Fix the obvious ones,** one commit each, each with the full suite green. Candidates to check against the profile, not to assume:
  - per-frame `new THREE.Vector3`/array allocations in `render.js`'s draw loop;
  - repeated `bodies.find((b) => b.kind === "sun")` in sim hot paths (cache the sun on the system);
  - `segmentHit` over every body for each projectile each tick (a bounding check first);
  - figures and looks updated while off screen.
- [ ] **Step 3: Tidy:** duplication and dead code found on the way, and any file over about 500 lines that splits cleanly. No property tests change.
- [ ] **Step 4: Measure after.** Same three measurements. Report before and after in the ledger and the final message. Run all checks: page, net, look, sound.
- [ ] **Step 5: Commit** each step as it lands.

### Task 10: Release

- [ ] **Step 1:** Final whole-branch review on the most capable model, then one fix pass (executing-plans).
- [ ] **Step 2:** Merge `friends-round` into `main` with `--no-ff`. Run the full suite on the merged result, then delete the branch. Check that every commit email is the noreply address, then push.
- [ ] **Step 3:** Deploy: `fly deploy --ha=false`, then `fly scale count 0 -a planet-arena` (the owner chose both). If either is refused or fails, give the owner the two commands. Update the backlog memory.
