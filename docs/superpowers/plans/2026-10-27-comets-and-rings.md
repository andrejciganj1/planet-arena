# Comets and Rings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three rideable comets on tilted, stretched orbits, an asteroid belt and a ringed giant (both
looks only), and dashed jump pad cues.

**Architecture:** Comets are bodies of kind `"comet"` in `BODIES`, with an elliptical orbit that
`posesAt` computes exactly from the clock (Kepler timing). Every orbit period divides 25 200 s, so the
whole system repeats and "never touches" and "a pass every 120 s" are proved over one full cycle. Any
contact with a comet grounds you, whatever the angle. The belt, the ring, the comet tails and the
dashed cue are drawing only.

**Tech Stack:** plain ES modules, three@0.160.0 from the import map, Node 22 test runner.

**Spec:** `docs/superpowers/specs/2026-10-27-comets-and-rings-design.md` (extends
`docs/superpowers/specs/2026-10-25-planet-arena-design.md`).

## Global Constraints

- Plain ES modules, three@0.160.0 from the import map in `index.html`; no bundler, no npm packages in the page.
- Every gameplay number lives in `src/tuning.js`. When a property test fails, change the numbers, never the test's property.
- `src/sim/` imports nothing from three.js or the DOM.
- Orbits are scripted from the match clock, never simulated. Fixed tick 1/60 s.
- No body, comets included, ever touches another body (surfaces more than 3 m apart).
- Everything stays inside `VOID_RADIUS` (400 m); riding a comet never counts as being lost in space.
- Jump pads keep their windows: every pad at least 5 s, every planet at least once a minute.
- Docs and comments: brief, explain why; no em dashes.
- Tests: `node --test 'tests/*.test.mjs'`. Page check (server on 8100):
  `NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/page_check.cjs "http://localhost:8100/?debug" shots/start.png` prints `OK`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- Hitting a comet side-on or from below, fast: you end up standing on it, never bounced away (Task 3 test).
- Riding the fast comet through perihelion, 10 m from the sun's surface: you stay on and alive (Task 3 test).
- Very late match times (hours in): comet poses stay exact; pose at t equals pose at t + CYCLE (Task 2 test).
- A pad flight that meets a comet: the cue predicts the comet honestly, but pad windows count only planets and the moon (Task 2 test change).
- Rockets and bullets hit comets like any body (Task 2 test).

## Values decided before this plan (from a feasibility search; keep them)

| id | period s | peri m | apo m | inc ° | node ° | arg ° | phase rad |
|---|---|---|---|---|---|---|---|
| comet-a (fast) | 240 | 38.8 | 260.3 | 12.4 | 37 | 219 | 3.39 |
| comet-b (fast) | 240 | 48.8 | 256.6 | 22.6 | 134 | 289 | 0.019 |
| comet-c (slow) | 600 | 38 | 281.7 | 8.1 | 61 | 239 | 5.894 |

Every comet: `kind: "comet"`, `radius: 3`, `g: 2`, `reach: 5.25`, `hold: 3`, `color: 0xbfe8ff`. Found with
this exact pose convention, over the full cycle: comet surfaces stay at least 7 m from every planet, the
moon and the sun, and 19 m from each other; some comet passes within 10 m (surface to surface) of some
planet at least every 104 s; comet-c passes the heavy and giant planets every 6 minutes or less, and a
plain jump at its first six heavy passes lands on the heavy planet.

---

### Task 1: Dashed pad cue

**Files:**
- Modify: `src/client/render.js:176-177` (cue material) and `:250-256` (cue update)

- [ ] **Step 1: Make the cue line dashed**

`pathMat` becomes `new THREE.LineDashedMaterial({ color: 0x3ee05a, dashSize: 1, gapSize: 0.7 })`. After
the cue's positions and draw range are updated, call `path.computeLineDistances()` (dashes need line
distances, and the path changes on every refresh). Orbit rings stay solid.

- [ ] **Step 2: Check the page and look at it**

Run the page check with `shots/start.png` (server on 8100). Expected: `OK`. Open the screenshot: the
player spawns on the mid planet near a pad, so the cue path is in view and dashed.

- [ ] **Step 3: Commit**

```bash
git add src/client/render.js
git commit -m "Dashed pad cues, so they don't look like orbits"
```

---

### Task 2: Comets on the clock

**Files:**
- Modify: `src/tuning.js` (comet bodies, `CYCLE`, `COMET`), `src/sim/system.js`
- Test: `tests/system.test.mjs`, `tests/collide.test.mjs`, `tests/gravity.test.mjs`, `tests/pads.test.mjs`
- Docs: `README.md` (comets in the body list; how to ride one)

**Interfaces:**
- Produces: `BODIES` entries `comet-a`, `comet-b`, `comet-c` with `orbit: { around: "sun", peri, apo, period, phase, inc, node, arg }`.
- Produces: `export const CYCLE = 25200;` (s; every orbit period divides it) and `export const COMET = { close: 10 };` (m between surfaces that counts as a close pass) in `src/tuning.js`.
- Produces: `posesAt(system, t)` gives comets `{ pos, vel }` like every other body.

- [ ] **Step 1: Write the failing tests** in `tests/system.test.mjs`

```js
const comets = BODIES.filter((b) => b.kind === "comet");

test("there are three comets, and every orbit period divides CYCLE", () => {
  assert.equal(comets.length, 3);
  for (const b of BODIES.filter((b) => b.orbit)) assert.equal(CYCLE % b.orbit.period, 0, b.id);
});

test("a comet's distance from the sun runs from peri to apo", () => {
  for (const c of comets) {
    let lo = Infinity, hi = 0;
    for (let t = 0; t < c.orbit.period; t += 0.05) {
      const d = len(posesAt(system, t)[c.id].pos);
      (lo = Math.min(lo, d)), (hi = Math.max(hi, d));
    }
    assert.ok(Math.abs(lo - c.orbit.peri) < 0.05 && Math.abs(hi - c.orbit.apo) < 0.05, c.id);
  }
});

test("a comet is fast near the sun and slow far out", () => {
  // Sampled every 0.05 s over one period: speed at the sample closest to the sun is more than 3 times
  // the speed at the sample farthest from it.
});

test("hours into a match, poses repeat exactly every CYCLE", () => {
  for (const t of [1234.5, 20000]) {
    const a = posesAt(system, t), b = posesAt(system, t + CYCLE);
    for (const id of Object.keys(a)) assert.ok(dist(a[id].pos, b[id].pos) < 1e-6, id);
  }
});

test("over the full cycle, no comet comes within 3 m of any body, the sun included", () => {
  // Every 0.1 s over CYCLE: comet surface to every other body's surface > 3.
});

test("over the full cycle, some comet passes close to some planet at least every 120 s", () => {
  // Every 0.5 s over CYCLE: a pass is any comet within COMET.close (surface to surface) of a body of
  // kind "planet". The longest stretch without a pass, including from 0 and to CYCLE, is <= 120.
});
```

Fill the two commented bodies; the comments are the assertions. The existing "vel matches the change
of pos" test already covers comet velocities once comets exist.

In `tests/collide.test.mjs` add: `test("a shot at a comet hits the comet")`: a segment from 10 m outside
comet-a's surface (at t = 42) to its centre, `segmentHit(...).id === "comet-a"`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/system.test.mjs tests/collide.test.mjs`
Expected: FAIL (no comets, `CYCLE` undefined).

- [ ] **Step 3: Add the comets and the elliptical pose**

In `src/tuning.js`: the three comet bodies from the table above, after `giant`; `CYCLE`; `COMET`; a
comment saying the comet values were searched so the full-cycle tests hold.

In `src/sim/system.js`: an orbit with `peri` is a tilted ellipse round its parent; circles are
unchanged. Use exactly this convention (the table's values depend on it):

```
a = (peri + apo) / 2, e = (apo - peri) / (apo + peri), b = a * sqrt(1 - e^2), n = 2 pi / period
M = (phase + n * t) mod 2 pi            // mod first, so late times stay exact
E: 12 Newton steps of E -= (E - e sin E - M) / (1 - e cos E), from E = M
in plane: x = a (cos E - e), y = b sin E; dE/dt = n / (1 - e cos E); vx = -a sin E dE/dt, vy = b cos E dE/dt
rotate (x, y) by arg:   x1 = x cos(arg) - y sin(arg),  z1 = x sin(arg) + y cos(arg)
tilt by inc:            y2 = z1 sin(inc),  z2 = z1 cos(inc)
turn about y by node:   X = x1 cos(node) - z2 sin(node),  Z = x1 sin(node) + z2 cos(node),  Y = y2
```

Velocity goes through the same three rotations. Angles in the table are degrees, phase is radians.
Update the file's header comment (orbits are no longer only circles).

- [ ] **Step 4: Run the new tests**

Run: `node --test tests/system.test.mjs tests/collide.test.mjs`
Expected: PASS.

- [ ] **Step 5: Keep the existing properties honest with comets present, then run everything**

- `tests/gravity.test.mjs`, "between the tiny and mid orbits, far from both, the sun dominates": "far"
  now means four reaches from every body except the sun, comets included.
- `tests/pads.test.mjs`: the timeline records `landsOn` as before, but the window tests ("every pad has
  at least one 5 s window", "from every planet, some pad's cue is on at least once a minute") count
  only landings on bodies whose kind is not `"comet"`. The cue itself still shows a comet landing: it
  is a true prediction.

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass. If a pad window test fails, re-search that planet's pad headings (keep its speed),
as the comment above `PADS` describes; a failing property is fixed with numbers, never by loosening it.

- [ ] **Step 6: Commit** (with the README lines)

```bash
git add src/tuning.js src/sim/system.js tests README.md
git commit -m "Three comets on tilted, stretched orbits"
```

---

### Task 3: Landing on and riding comets

**Files:**
- Modify: `src/sim/entity.js` (step 7-8 contacts and the snap)
- Test: `tests/entity.test.mjs`, `tests/world.test.mjs`

**Interfaces:**
- Consumes: Task 2's comet bodies and poses.
- Produces: a contact with a body of kind `"comet"` grounds the entity whatever the angle between the
  contact normal and `e.up`; the ground snap keeps a comet rider whatever that angle. Up then turns to
  the comet's normal at `PLAYER.upTurn` as usual.

- [ ] **Step 1: Write the failing tests**

In `tests/entity.test.mjs`:

```js
test("drifting into a comet side-on, fast, you land on it", () => {
  // For comet-a at three times (one near perihelion), and four approach directions perpendicular to e.up:
  // place an entity 2 m outside the surface, world velocity = comet velocity + 8 m/s towards its centre,
  // up perpendicular to that direction. Within 1 s: groundId is the comet. 1 s after that: still the
  // comet, and dot(up, surface normal) > cos(10 degrees).
});
```

In `tests/world.test.mjs` (pad-free worlds, `w.pads = []`, dummy out of the way, as the existing tests do):

```js
test("riding a comet for a whole lap, through perihelion and aphelion, you stay on and alive", () => {
  // comet-a (240 s) and comet-c (600 s): player stood on the comet with standOn; stepWorld with no
  // input for one period; every tick p.alive and p.groundId === the comet.
});

test("jumping off the slow comet at a close pass lands you on that outer planet", () => {
  // For each close pass of comet-c to mid, heavy or giant in the first 1800 s (closest approach within
  // COMET.close): 3 s before it, stand on the comet's point facing the planet; at closest approach,
  // jump; within 20 s groundId is that planet. At least one pass must be found.
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/entity.test.mjs tests/world.test.mjs`
Expected: the side-on landing test FAILS (the contact is too steep to count as ground). The two riding
tests may already pass; they guard the change.

- [ ] **Step 3: Implement the comet catch in `stepEntity`**

In step 8, a contact counts as ground when it is within `groundAngle` of up, or when its body's kind is
`"comet"`. In the snap, skip the angle check when the ground body is a comet. Comment why: a comet
should catch you, not bounce you away.

- [ ] **Step 4: Run everything**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/entity.js tests
git commit -m "Comets catch you whatever angle you hit them at"
```

---

### Task 4: How comets, the belt and the ring look

**Files:**
- Modify: `src/tuning.js` (`BELT`; `ring` on `giant`), `src/client/render.js`
- Test: `tests/system.test.mjs`
- Docs: `README.md` (belt and ring, both scenery)

**Interfaces:**
- Produces: `export const BELT = { inner: 138, outer: 150, thick: 4, rocks: 500, size: [0.4, 1.8], period: 260 };` (looks only) and `ring: { inner: 1.4, outer: 2.3, tilt: 18 }` on the giant (multiples of its radius, tilt in degrees; looks only).

- [ ] **Step 1: Write the failing test** in `tests/system.test.mjs`

```js
test("the asteroid belt stays clear of every planet's and the moon's path", () => {
  // In the orbital plane: every planet's band [R - r, R + r] and the moon's [heavyR - 40 - 5, heavyR + 40 + 5]
  // is at least 3 m from [BELT.inner, BELT.outer].
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/system.test.mjs`
Expected: FAIL (`BELT` undefined).

- [ ] **Step 3: Add `BELT` and the giant's `ring` to `src/tuning.js`; run the test**

Expected: PASS.

- [ ] **Step 4: Draw them in `src/client/render.js`**

- **Comet:** the usual faceted sphere plus a glow sprite (`glowSprite(0xbfe8ff, radius * 5)`), and a tail:
  an open cone, additive, `opacity 0.35`, `depthWrite: false`, its base at the comet and its tip
  pointing away from the sun, length `min(60, 12 + 1600 / distance to the sun)`, base radius 2.2.
  Update its direction and length every frame.
- **Comet orbit line:** like the planets' rings, but from `posesAt(world.system, t)` sampled at 256
  points over one period. Solid, same faint colour.
- **Belt:** one `InstancedMesh` of `BELT.rocks` flat-shaded dodecahedrons, grey-brown, seeded from the
  existing `rng`: radius in `[inner, outer]`, height within `±thick / 2`, size in `size`, each with its own
  spin axis and rate. The group turns once per `BELT.period` the same way the planets go round; each
  frame updates the instance matrices so the rocks tumble.
- **Ring:** a double-sided, semi-transparent `RingGeometry(r * inner, r * outer, 96)`, pale violet, child
  of the giant's mesh, tilted by `tilt` from the orbital plane.

- [ ] **Step 5: Check the page and look at it**

Run the page check twice: `?debug` to `shots/start.png`, and `?debug&view=0,330,420,0,0,0` to
`shots/system.png`. Expected: `OK` both times, and the clock keeps real time (the belt's per-frame
updates must not slow it). In `shots/system.png`: three comet orbits, the belt between the mid and heavy
planets' paths, the ringed giant. Then one close-up of a comet: pick its position from
`posesAt(system, t)` at the page's start time and set `?view` a few tens of metres away, so the tail
is visible.

- [ ] **Step 6: Run everything and commit**

Run: `node --test 'tests/*.test.mjs'`. Expected: all pass.

```bash
git add src/tuning.js src/client/render.js tests README.md
git commit -m "Comet tails and orbits, the asteroid belt, the giant's ring"
```
