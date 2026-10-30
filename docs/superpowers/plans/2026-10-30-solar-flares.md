# Solar Flares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every minute or two the sun warns, then flares, burning players in its light near the sun, with the approved look, a spoken warning and a burn the server decides.

**Architecture:**
- **Schedule.** The schedule is a pure function of the match clock in `src/sim/flares.js`, so the server, the client's look, the HUD and the sounds all agree with nothing sent.
- **Burn.** Burn rules (shadow by `segmentHit`, a distance falloff) run in `stepWorld`.
- **Client.** The client reads the same functions to show the banner, tint, sizzle and the look. That look is already built as a spike on branch `solar-flare` (`src/client/look/solarflare.js`); this plan moves it onto the real schedule.

**Tech Stack:** plain ES modules, three@0.160.0 (import map), Web Audio, `node --test`, Playwright checks through `npx`, Piper 1.8.0 (only to make one voice file).

**Spec:** `docs/superpowers/specs/2026-10-30-solar-flares-design.md`

## Global Constraints

- Plain ES modules, three@0.160.0 from the import map in `index.html`; no bundler, no npm dependencies in the page.
- Every gameplay number lives in `src/tuning.js`; looks-only numbers in `LOOK`. When a property test fails, change the numbers, never the test's property.
- `src/sim/` imports nothing from three.js or the DOM; `src/net/` has no DOM or Node-only APIs.
- Orbits are scripted from the match clock. Fixed tick 1/60 s.
- Own assets only. Docs and comments brief, explaining why; no em dashes.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; author email is the noreply address already configured.
- Work stays on branch `solar-flare`. No merge, push or Fly deploy without the owner's word.

## Rulings on the spec (approved by the owner with this plan)

1. **Voice.** The warning voice is a file made like "Sun kill!", the same public-domain Norman voice with Piper, played through the announcer's `say` chain. Browser speech is not used. Why: the same announcer on every computer.
   - If Piper or the voice can't be fetched, fall back to `speechSynthesis` as the spec first said, and record a ruling.
2. **No hit flash or hurt sound from the flare.** Flare damage pushes no `"hit"` event, because a hit every tick would flash and play "hurt" 60 times a second. The orange tint and the sizzle are the feedback. Flare damage also never sets `lastHitBy`.
3. **The interval runs from one warning to the next,** 60 to 120 s apart (about 90, give or take 30), with the first warning no earlier than 60 s.
4. **Shadow line.** The shadow line starts at `hitCentre(e)` (the movement sphere's centre, as the sun death uses), not `PLAYER.hit.body`; they are 0.1 m apart.

The spec gets these four lines in Task 1's commit.

## Review Focus

1. **A late join or clock jump mid-warning.** The banner shows the right countdown at once, and the alarm and voice don't play late or twice. Tested in Task 5.
2. **The day and night line.** A player a few degrees into the night side takes nothing, and a few degrees into the day side burns, so the burn agrees with what the planet shader shows lit. Tested in Task 2.
3. **Shade from a lumpy comet's dent side.** The shadow uses the comet's real shape. Tested in Task 2.
4. **The client's cosmetic world.** It must never deal flare damage, or online health would double-count and jitter. Tested in Task 2.
5. **Respawning on a planet whose every free spot is lit.** The respawn falls back to the usual spot rather than failing. Tested in Task 3.

---

### Task 1: The flare schedule

**Files:**
- Modify: `src/tuning.js` (new `FLARE` block after `KILL`)
- Create: `src/sim/flares.js`
- Test: `tests/flares.test.mjs`
- Modify: `docs/superpowers/specs/2026-10-30-solar-flares-design.md` (the four rulings above, short)

**Interfaces:**
- Produces: `FLARE = { first: 75, every: 90, jitter: 15, warn: 10, burn: 6, fade: 3, rate: 25, full: 80, reach: 150 }`. Each number gets a comment.
  - `first` and `every`: slot k's warning is at `first + k * every + j_k`, with `j_k` in `[-jitter, jitter]`. So the first comes at 60 to 90 s, and warnings are 60 to 120 s apart.
  - `fade`: s of look after the burn, with no damage.
  - `rate`, `full`, `reach`: health/s within `full` m, falling linearly to 0 at `reach` m.
- Produces: `flareAt(t, F = FLARE)` in `src/sim/flares.js`. It returns `{ k, warnAt, burnAt, endAt, phase }` for the flare whose window `[warnAt, endAt + F.fade)` holds t, or else the next one.
  - `burnAt = warnAt + F.warn` and `endAt = burnAt + F.burn`.
  - `phase` is `"calm" | "warn" | "burn" | "fade"`.
  - `j_k = (hashRand(\`flare|${k}\`)() * 2 - 1) * F.jitter`, with `hashRand` from `src/sim/weapons.js`. O(1): look at slots floor((t - first)/every) and its neighbours only. Never loop from 0, since the server's clock runs for days.

- [ ] **Step 1: Write the failing tests** in `tests/flares.test.mjs`:
  - `"the schedule is a pure function of the clock"`: `flareAt(t)` deep-equals itself for t in 0..2000 step 7.3.
  - `"no flare warns before 60 s, and warnings come 60 to 120 s apart"`: walk t from 0 to 20000 in steps of 0.5, collecting distinct `warnAt`. Assert the first is at least 60 and every gap is in [60, 120].
  - `"each flare warns 10 s, burns 6 s, then fades 3 s"`: for 50 flares, `flareAt(warnAt + 0.01).phase === "warn"`, `flareAt(burnAt + 0.01).phase === "burn"`, `flareAt(endAt + 0.01).phase === "fade"` and `flareAt(endAt + 3.01).phase === "calm"`.
  - `"a huge clock is as quick as a small one"`: `flareAt(1e7)` returns, with `k` near `(1e7 - 75) / 90`.
- [ ] **Step 2: Run** `node --test tests/flares.test.mjs`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** the `FLARE` block and `flareAt` as above.
- [ ] **Step 4: Run** `node --test tests/flares.test.mjs`. Expected: PASS. Then run `node --test 'tests/*.test.mjs'`: all pass.
- [ ] **Step 5: Commit**: `git add src/tuning.js src/sim/flares.js tests/flares.test.mjs docs/superpowers/specs/2026-10-30-solar-flares-design.md && git commit -m "Solar flares: the schedule, a pure function of the match clock"`

### Task 2: The burn

**Files:**
- Modify: `src/sim/flares.js`
- Modify: `src/sim/world.js` (`stepWorld`: call the burn after `stepAsteroids`; death cause)
- Modify: `src/client/hud.js` (`DEATHS.flare = "Burned by the flare"`, `MARKS.flare = "☀"`)
- Test: `tests/flares.test.mjs`

**Interfaces:**
- Consumes: `flareAt` (Task 1), `segmentHit(system, poses, a, b)` from `src/sim/collide.js`, `hitCentre(e)` from `src/sim/entity.js`.
- Produces:
  - `sunlit(world, p)` returns true when the segment from p to the sun's centre meets no body before the sun (`segmentHit` returns the sun or null).
  - `burnRate(world, e)` returns health/s. It is 0 unless the phase is `"burn"`, `e.alive`, `e.kind` is `"player"` or `"dummy"`, `sunlit(world, hitCentre(e))`, and d < `reach`.
    - d is the distance from `hitCentre(e)` to the sun's centre.
    - The rate is `F.rate` up to `full`, then linear to 0 at `reach`.
  - `stepFlare(world, dt)`:
    - Each alive entity with a rate above 0 loses `rate * dt` health and gets `e.flareTick = world.tick`.
    - It does nothing when `world.cosmetic`.
    - It pushes no events and never touches `lastHitBy` (Ruling 2).
  - In `stepWorld`'s death loop, `e.health <= 0` dies with cause `"flare"` when `e.flareTick === world.tick`, else `"damage"`. Credit is unchanged (`creditOf`).

- [ ] **Step 1: Write the failing tests** in `tests/flares.test.mjs`. Use `createWorld(tuning)` and `stepWorld` from `src/sim/world.js`. Find a burn time with `flareAt`, set `world.t` just before it, and recompute poses with `posesAt` as `tickClock` does. Place the entity with `createEntity` plus `standOn`, as `spawn` does. The tests:
  - `"the burn falls off with distance: full to 80 m, nothing past 150 m"`: a free-floating player (no ground) at 46, 78, 108, 150 and 200 m from the sun on the line to the sun, unshaded, during a burn. The rates are 25, 25, 25*(150-108)/70 within 0.01, 0 and 0.
  - `"standing on Hot's sunny side you die in 4 to 5 s"`: player at Hot's subsolar point (`up` towards the sun). Step `stepWorld` with no input from the burst. Death comes between 4 and 5 s, with a `death` event whose cause is `"flare"`.
  - `"the night side is shelter, and the day and night line is where it should be"`: on Hot, points 5 degrees past the terminator into the night get rate 0; 5 degrees into the day get above 0.
  - `"a moon or a comet's shadow is shelter"`:
    - Mid's moon: search a clock in the burns where it is under 120 m from the sun. A free-floating player 1 m behind its surface on the sun line gets rate 0; offset sideways by the moon's radius plus 2 m, above 0.
    - Comet: the same with comet-a near perihelion, using `radiusAt` so the point is just behind the real lumpy surface.
  - `"nothing burns outside the burn"`: the same subsolar player loses no health through a whole warning and a whole fade.
  - `"the dummy burns; a cosmetic world burns nobody"`: the dummy on Tiny's subsolar point loses health. With `world.cosmetic = true`, the same player keeps full health.
  - `"a flare death credits the last hitter as falling into the sun does"`: set `e.lastHitBy = "other"`, `world.scores.other = { kills: 0, deaths: 0 }`, `e.lastHitAt = world.t`, and keep the player off the ground so the hit does not expire. The death event has `by: "other"` and `world.scores.other.kills === 1`.
- [ ] **Step 2: Run** `node --test tests/flares.test.mjs`. Expected: the new tests FAIL (`burnRate` is not exported).
- [ ] **Step 3: Implement** `sunlit`, `burnRate`, `stepFlare`, the `stepWorld` call and the death cause. Add the HUD's `DEATHS`/`MARKS` entries.
- [ ] **Step 4: Run** `node --test 'tests/*.test.mjs'`. Expected: all pass. If a falloff or timing test fails, change `FLARE` numbers, never the tests' properties.
- [ ] **Step 5: Commit**: `git commit -am "Solar flares burn players in the sun's light near it; shadow is shelter"` (add `tests/flares.test.mjs` if new hunks).

### Task 3: Respawns out of the flare's reach

**Files:**
- Modify: `src/sim/world.js` (`spawnGap`)
- Test: `tests/flares.test.mjs`

**Interfaces:**
- Consumes: `flareAt`, `sunlit` and the falloff (Task 2). Add `flareReach(world, p)` to `flares.js`, returning the rate a point would get in the burn ignoring the phase, so a warning-time spawn can be judged.
- Produces: during phases `"warn"` and `"burn"`, `spawnGap` skips candidates where `flareReach(world, add(cand.pos, scale(cand.up, PLAYER.radius))) > 0`, the same way it skips spots near pads. If that leaves none, it runs again without the rule, so a respawn never fails.

- [ ] **Step 1: Write the failing tests:**
  - `"a respawn during a warning or a burn lands out of the flare's reach"`: solo world. At 10 times inside warnings and burns, kill the player and step to its respawn. The new position has `flareReach === 0`. Also kill the dummy and check it lands on Tiny out of reach.
  - `"if every spot is lit, the respawn still happens"`: pass a stub that makes every candidate lit (export the predicate for tests, or a tuning `reach` of 1e9 in a copied tuning). The player still respawns on its body.
- [ ] **Step 2: Run** `node --test tests/flares.test.mjs`. Expected: FAIL on the first test.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test 'tests/*.test.mjs'`. Expected: all pass.
- [ ] **Step 5: Commit**: `git commit -am "A respawn during a flare lands out of its reach"`

### Task 4: Protocol 5

**Files:**
- Modify: `src/net/protocol.js` (`PROTOCOL = 5`), `tests/protocol.test.mjs` (`"PROTOCOL is 5"`, asserting 5)

- [ ] **Step 1:** Change the test to 5. Run `node --test tests/protocol.test.mjs`. Expected: FAIL.
- [ ] **Step 2:** Set `PROTOCOL = 5`, with a comment naming flares as the change. Run all tests. Expected: PASS.
- [ ] **Step 3: Commit**: `git commit -am "PROTOCOL 5: solar flares change the rules"`

### Task 5: Warning banner, burn tint and sounds

**Files:**
- Create: `src/client/look/flarepose.js` (pure, no three.js: node tests load it)
- Modify: `src/client/hud.js`, `index.html` (CSS for `.hud.flare` banner and `.hud.burn` tint), `src/client/main.js`
- Modify: `src/client/sounds.js`, `src/client/synth.js`, `tools/sound_check.cjs` (`LONGEST` entries), `README.md` (voice credit and flares)
- Create: `assets/flare-warning.wav` (Piper 1.8.0, Norman voice, "Imminent solar flare detected", trimmed)
- Modify: `src/tuning.js` (`SOUND` and `LOOK` entries for the new sounds and the tint)
- Test: `tests/hud.test.mjs`, `tests/sounds.test.mjs`, `tests/voice.test.mjs`

**Interfaces:**
- Consumes: `flareAt`, `burnRate`.
- Produces:
  - `flareBanner(t)` in `flarepose.js`:
    - in `"warn"`: `{ text: "IMMINENT SOLAR FLARE DETECTED", count: Math.ceil(burnAt - t) }`;
    - in `"burn"`: `{ text: "SOLAR FLARE: GET OUT OF THE LIGHT", count: null }`;
    - otherwise null.
  - `hud.update(world, locked, now, selfId, camera, feel, flare)`, where `flare = { banner, burning }` and `burning = burnRate(world, p) > 0`, computed in `main.js` from the drawn world. The banner shows top centre. The tint is an orange radial overlay pulsing about 3 times a second while burning, with its opacity in `LOOK`.
  - New `SOUNDS`: `"flareAlarm"` (one-shot two-tone klaxon, about 1.5 s), `"flareVoice"` (the clip through `say`), `"flareRoar"` (one-shot deep roar, about 2 s) and `"sizzle"` (loop, added to `LOOPS`).
    - The director pushes `flareAlarm` and `flareVoice` (both `pos: null`) once when `lastT < warnAt <= world.t`, and `flareRoar` once when `lastT < burnAt <= world.t`, both only on a frame without a gap.
    - The `sizzle` loop runs while your own `burnRate > 0`.
    - `loadVoice` also loads the new clip.

- [ ] **Step 1: Write the failing tests:**
  - `tests/hud.test.mjs`: `"the flare banner counts down the warning, then tells you to get out of the light"`. 1 s into a warning, the text and count are 9; in the burn, the burn text with count null; in calm, null.
  - `tests/sounds.test.mjs`:
    - `"a flare's warning sounds the alarm and the voice once, and its burst roars once"`: drive `frame` across `warnAt` and `burnAt` in 1/60 steps. Each sound appears exactly once.
    - `"joining mid-warning plays no late alarm"`: the first frame is mid-warning and the next steps on. No alarm or voice.
    - `"you hear the sizzle only while you burn"`: player subsolar on Hot in a burn, the loop is present; on the night side, absent.
  - `tests/voice.test.mjs`: the flare clip loads like the others, following that file's existing pattern.
- [ ] **Step 2: Run** `node --test tests/hud.test.mjs tests/sounds.test.mjs tests/voice.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Make the voice file.**
  - Install `piper-tts==1.8.0` into a venv in the scratchpad, and fetch the Norman voice from https://brycebeattie.com/files/tts/ into a fresh scratch directory. These are dev tools only; nothing of them ships.
  - Speak "Imminent solar flare detected." Trim silence, and save 22.05 kHz mono 16-bit to `assets/flare-warning.wav`, under 200 KB.
  - Credit it in `README.md` beside the other two.
  - If either download fails: Ruling 1's fallback.
- [ ] **Step 4: Implement:**
  - `flareBanner`;
  - the HUD pieces and CSS;
  - the `main.js` wiring;
  - the three recipes and the loop in `synth.js`, built from its existing helpers (`tone`, `hiss`, `looped`, `bed`, `wobble`, `say`);
  - the director rules;
  - `LONGEST` in `sound_check.cjs` for `flareVoice`, `flareRoar` and `flareAlarm` as measured.
- [ ] **Step 5: Run** `node --test 'tests/*.test.mjs'`. Expected: all pass. With the static server running, also run the sound check from `CLAUDE.md`. Expected: `OK`, and the new sounds are listed.
- [ ] **Step 6: Commit**: `git add -A src tests assets/flare-warning.wav index.html tools/sound_check.cjs README.md && git commit -m "Flare warning on screen and spoken, a roar at the burst, a sizzle and an orange tint while you burn"`

### Task 6: The look on the real schedule

**Files:**
- Modify: `src/client/look/flarepose.js`, `src/client/look/solarflare.js`, `src/client/look/sun.js`, `src/client/render.js`, `src/client/main.js`, `src/tuning.js` (`LOOK.flare`), `tools/look_check.cjs`
- Test: `tests/look.test.mjs`

**Interfaces:**
- Consumes: `flareAt`, `FLARE`.
- Produces: `flareView(t)` in `flarepose.js` replaces the spike's `flareState`. It returns the same shape `{ warn, burn, since, dir, dir2 }`:
  - `warn` is 0..1 through the warning.
  - `burn` rises over `LOOK.flare.rise`, holds at 1 until 1 s before `endAt`, then falls to 0 at `endAt`. That way the sun blazes for as long as the damage lasts.
  - `since` is s from `burnAt` (-Infinity before the warning), so the arches and cloud fade over `FLARE.fade`.
  - `dir` and `dir2` come from `hashRand(\`flare-dir|${k}\`)` with the spike's formulas (`LOOK.flare.second.apart` degrees apart).
  - `LOOK.flare.spike`, `decay` and `after` go. The look uses `FLARE.burn` and `FLARE.fade`.
  - The `flareAt` option and `?flare=` parameter go. `?debug&at=T` at a flare time shows that moment.

- [ ] **Step 1: Write the failing tests** in `tests/look.test.mjs`:
  - `"the flare's look follows the schedule"`: `flareView` is calm (warn 0, burn 0) between flares; warn rises 0 to 1 through the warning; `burn` is 1 from 0.5 s after `burnAt` until `endAt - 1`, and 0 after `endAt`.
  - `"the two patches stand 130 to 140 degrees apart"`: for 30 flares, the angle between `dir` and `dir2` is in [130, 140].
- [ ] **Step 2: Run** `node --test tests/look.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** and remove the spike timeline.
  - Quality: at level 0, the plasma cloud is hidden and the arches use 6 tube segments round instead of 8. Put the counts in `LOOK.flare`.
  - Add look check views `flare-warn`, `flare-burst` and `flare-cloud`, plus `flare-mid` (from Mid's sunny side at the burst, to see the bleach). Their `at` comes from `flareAt` via `await import()` of `src/sim/flares.js`.
- [ ] **Step 4: Run** `node --test 'tests/*.test.mjs'`, then the look check with pattern `'flare'`. Expected: `OK`. Read the four screenshots: warning arches visible, burst white, cloud lifting, Mid's sunny side bleached and its night side dark.
- [ ] **Step 5: Commit**: `git add -A src tests tools && git commit -m "The flare's look runs on the real schedule"`

### Task 7: Whole-game checks

- [ ] **Step 1:** Run the page check from `CLAUDE.md` (`?debug`) and the two-browser net check with the local server (`(cd server && node server.js &)`, then kill it). Expected: `OK` from both. Fix anything they find.
- [ ] **Step 2:** Run the full look check (no pattern). Expected: `OK`. The frame times are comparable with before (this machine measured 30 fps under load for the previous commit too; compare with `git stash` if in doubt).
- [ ] **Step 3:** Update `CLAUDE.md` only if a command or debug parameter changed (the `?flare=` parameter is gone, `?at` covers it). Commit any fixes.
