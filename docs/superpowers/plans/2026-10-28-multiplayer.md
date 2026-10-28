# Online Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to 8 players (built for 5) play one shared Planet Arena game from a link, with a Node server on
Fly.io as referee, instant own movement, fair hits under lag, and kills/deaths that reset when everyone
has gone.

**Architecture:** The server runs the existing `src/sim/` world at 60 Hz and is the referee. Each browser
runs its own clock a few ticks ahead of the server and stamps every input with the tick it belongs to, so
server and browser step the player with the same inputs on the same planet poses and agree exactly;
snapshots correct the rest. Other players are drawn about 100 ms in the past, grounded ones relative to
their body, and the server rewinds them to that same view when it checks a hit.

**Tech Stack:** Node 22, plain ES modules, three@0.160.0 (page), `ws` 8 (server only), `node:test`,
Playwright via `npx` (local checks), Docker + Fly.io (Frankfurt), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-28-multiplayer-design.md` (main spec:
`docs/superpowers/specs/2026-10-25-planet-arena-design.md`).

## Global Constraints

- Desktop browser from a link, no install; keyboard and mouse.
- Plain ES modules; three@0.160.0 from the import map in `index.html`; no bundler, no npm dependencies in
  the page. The server may use npm packages (`ws`); only `server/server.js` imports them, so
  `node --test 'tests/*.test.mjs'` runs without `npm install`.
- `src/sim/` and `src/net/` import nothing from three.js or the DOM (the server runs them).
- Every gameplay number lives in `src/tuning.js`. When a property test fails, change the numbers, never
  the test's property.
- Orbits are scripted from the match clock, never simulated. Fixed tick 1/60 s. Planet poses are never sent.
- Solo play (page opened from `tools/serve.py`) keeps working exactly as now, with the dummy.
- Up to 8 players; a ninth gets "The game is full". Names: plain text, up to 16 characters, duplicates get
  " 2", " 3".
- Spawns (online): only `tiny`, `mid`, `heavy`, `giant`, away from other players.
- Kill credit: the last player who damaged you keeps it until you have stood on something for about 1 s
  and 1 s has passed since the hit, or someone else hits you. Self deaths: a death, no kill, no point lost.
  Dummy kills don't count.
- Reconnect within 10 s with the token: same player, same score, no death counted. The body leaves at once.
- The game resets (clock 0, pickups back, every counter 0/0) when nobody is connected and nobody is
  within their 10 s reconnect window.
- Lag compensation for every weapon, rocket blasts included (distance and push direction measured from
  where the shooter saw the target, push added to the target's current speed). Lag is capped.
- No floating damage numbers. Other players: name and health bar, shrinking with distance, hidden behind
  bodies, bar flashes white on a hit.
- Privacy: nothing stored beyond the running game; the server never logs names.
- Nothing is deployed, pushed or published without the owner saying so. Fly.io and GitHub settings use the
  owner's personal accounts only.
- Docs and comments: brief, explain why; no em dashes. Code reads like the surrounding code.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Hostile or broken messages (NaN, Infinity, strings where numbers go, unknown weapons, huge ticks,
   non-JSON) must never crash the server or poison the shared world with NaN. Tested in Task 4 and Task 5.
2. A hidden or throttled tab stops sending inputs: the server must let go of that player's held keys
   (no endless running or firing), and on return the browser must resync its clock instead of replaying
   minutes of ticks. Tested in Task 5 and Task 7.
3. Players leaving while referenced: kill credit pointing at a departed player, the dummy leaving with
   its credit or projectiles in flight, a hook or projectile owned by someone gone. Nothing crashes and
   no score goes to a missing player. Tested in Task 1 and Task 5.
4. The same reconnect token used by two tabs at once, or a token from a game that has since reset: the
   second gets a fresh player, never a shared body. Tested in Task 5.
5. JSON loses `-Infinity` (fields such as `lastHitAt` and `padLockUntil` start at `-Infinity`): a
   snapshot round trip must give back the same entity, or prediction drifts. Tested in Task 4.

---

## File map

- `src/tuning.js`: new `SPAWN_BODIES`, `KILL`, `NET`, `COLOURS`.
- `src/sim/world.js`: online worlds (`createWorld(tuning, { solo })`), `addPlayer`, `removePlayer`,
  `creditOf`, `tickClock`, `stepPlayer`, scores and kill credit, death blasts.
- `src/sim/entity.js`: new fields `groundTime`, `shots`; `NO_INPUT.lag`.
- `src/sim/weapons.js`: per-shooter spread, projectile ids, lag-compensated hits, cosmetic mode.
- `src/sim/lag.js` (new): the server's short history and "where the shooter saw them".
- `src/net/protocol.js` (new): version, input and name cleaning, entity and snapshot records.
- `src/net/predict.js` (new): the browser's own-player prediction and correction.
- `src/net/interp.js` (new): other players and shots drawn in the past.
- `server/game.js` (new): the game room as plain functions (join, leave, inputs, ticks, snapshots, reset).
- `server/server.js`, `server/package.json` (new): WebSockets and the real-time loop.
- `src/client/net.js` (new): the WebSocket connection with its status and retries.
- `src/client/online.js` (new): ties prediction, interpolation, the clock and the connection together.
- `src/client/config.js` (new): the server address.
- `src/client/main.js`, `render.js`, `hud.js`, `index.html`: modes, many players, tags, effects, scores.
- `Dockerfile`, `.dockerignore`, `fly.toml`, `.nojekyll` (new); `tools/net_check.cjs` (new);
  `README.md`, `CLAUDE.md`.

---

### Task 1: Players, spawns, scores and kill credit in the sim

**Files:**
- Modify: `src/tuning.js`, `src/sim/entity.js`, `src/sim/world.js`
- Test: `tests/players.test.mjs` (new)

**Interfaces:**
- Produces:
  - tuning: `SPAWN_BODIES = ["tiny", "mid", "heavy", "giant"]`; `KILL = { standing: 1 }` (s);
    `COLOURS` = 8 distinct hex colours (index 0 is the solo player's);
    `NET = { maxPlayers: 8, snapEvery: 2, interp: 6, slack: [2, 5], hold: 15, maxAhead: 60, maxLag: 0.5,
    history: 0.6, rejoin: 10, unreachable: 30, smooth: 0.1, snap: 4, resync: 30, lead: 6, nameMax: 16 }`
    (ticks unless noted: `maxLag`, `history`, `rejoin`, `unreachable`, `smooth` are seconds, `snap` is m).
  - entity fields: `groundTime` (s grounded without a break, set in `stepEntity` like `airTime`),
    `shots` (shots fired, 0 at spawn). `NO_INPUT.lag = 0`.
  - `createWorld(tuning, { solo = true } = {})`: solo is today's world plus
    `world.players = { player: { name: "You", colour: COLOURS[0] } }` and
    `world.scores = { player: { kills: 0, deaths: 0 } }`; `world.solo = solo`. Online (`solo: false`):
    no entities, empty `players` and `scores`, and `world.noCues = true` (the server skips pad cues).
  - `addPlayer(world, id, { name, colour }) -> entity`: kind `"player"`, spawned by the online rule,
    registered in `players`, `scores` set to 0/0 unless already present (a reconnect restores it
    beforehand); then the dummy rule.
  - `removePlayer(world, id)`: removes the entity and its `players` entry (scores stay for the caller to
    keep or drop; `removePlayer` deletes them too unless `{ keepScore: true }`); then the dummy rule.
  - Dummy rule (online worlds only): the dummy exists exactly while one player is in the world.
  - `creditOf(world, e) -> id | null`: `e.lastHitBy` if that id is in `world.scores`, else null.
  - Each tick in `stepWorld`, for each alive entity: if `lastHitBy` and `groundTime >= KILL.standing` and
    `t - lastHitAt >= KILL.standing`, clear `lastHitBy`.
  - Death: event `{ type: "death", id, cause, by, pos }` (`by` from `creditOf`, `pos` the hit centre).
    Scores only for kind `"player"` victims: victim `deaths + 1`; `by` (not the victim) `kills + 1`.
    Sun and damage deaths push `{ pos, age: 0 }` to `world.explosions` (drawn like a rocket blast, no
    damage); void deaths don't.
  - Online respawns: a random body from `SPAWN_BODIES` (from `world.rand`), then `spawnPoint` on it; if
    the nearest other alive entity is closer than `PLAYER.spawnFromOther`, try the other central bodies
    and keep the point with the biggest gap. Solo respawns stay on `PLAYER_BODY`, the dummy on `DUMMY.body`.
    Export `spawnGap(world, bodyId, forId) -> { pos, up, gap }` from the existing `spawnPoint` logic so
    both share it.

- [ ] **Step 1: Write the failing tests in `tests/players.test.mjs`**

```js
// Helpers: online() = createWorld(tuning, { solo: false }) with pads: [];
// two(w) adds "a" and "b" with distinct names and colours and returns [a, b];
// float(w, e, pos, vel) puts e in open space (groundId null, airTime 0, groundTime 0).
test("an online world starts empty; one player gets the dummy, a second sends it away, it comes back when one is left", () => {
  const w = online();
  assert.deepEqual(Object.keys(w.entities), []);
  addPlayer(w, "a", { name: "A", colour: COLOURS[1] });
  assert.ok(w.entities.dummy);
  addPlayer(w, "b", { name: "B", colour: COLOURS[2] });
  assert.equal(w.entities.dummy, undefined);
  removePlayer(w, "b");
  assert.ok(w.entities.dummy);
  assert.deepEqual(w.scores, { a: { kills: 0, deaths: 0 } });
});
test("online players spawn only on the central planets, away from each other", () => {
  // 5 players; kill one at a time (health 0) and step until respawned, 40 times.
  // Each respawn: groundId in SPAWN_BODIES; distance to every other alive player >= PLAYER.spawnFromOther;
  // over the 40 respawns every one of the 4 bodies is used.
});
test("a knock into the sun is the hitter's kill, even after a long fall", () => {
  // a explodes a rocket next to floating b: explode(w, add(hitCentre(b), [1, 0, 0]), "a").
  // Step 15 s with b kept floating (groundId null), then put b in the sun and step once.
  // death event: { id: "b", cause: "sun", by: "a" }; w.scores.a.kills === 1, w.scores.b.deaths === 1.
});
test("standing for a second after the hit clears the credit", () => {
  // as above, then standOn(b, "mid") at the surface and step 1.1 s, then into the sun:
  // by === null, scores.a.kills === 0, scores.b.deaths === 1.
});
test("hit while standing, dead within the second: still the hitter's kill", () => {
  // b stands on mid for 5 s (groundTime >= 5); a explodes next to b; 0.5 s later b into the sun: by === "a".
});
test("your own rocket: a death for you, a kill for nobody, no point lost", () => {
  // b.health = 10; explode(w, hitCentre(b), "b"); step: death cause "damage", by null;
  // scores.b = { kills: 0, deaths: 1 }.
});
test("dummy kills don't count", () => {
  // one player a; the dummy into the sun right after a's blast: death event by "a", scores.a.kills === 0.
});
test("credit to a player who has left goes to nobody", () => {
  // a hits b, removePlayer(w, "a"), b into the sun: by === null, no throw, scores has no "a".
});
test("sun and damage deaths leave a blast where they happened; the void doesn't", () => {});
test("the solo world: the player starts and respawns on PLAYER_BODY, with scores for 'player'", () => {});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/players.test.mjs`
Expected: FAIL (`addPlayer` is not exported).

- [ ] **Step 3: Implement the interfaces above in `src/tuning.js`, `src/sim/entity.js`, `src/sim/world.js`**

`spawn()` replaces the entity with `createEntity`, which resets `lastHitBy`, `groundTime` and `shots`;
scores live in `world.scores` so they survive respawns.

- [ ] **Step 4: Run the new tests and the whole suite**

Run: `node --test tests/players.test.mjs && node --test 'tests/*.test.mjs'`
Expected: PASS, all of them (the solo world is unchanged).

- [ ] **Step 5: Commit** (`Players, spawns, scores and kill credit in the simulation`)

---

### Task 2: One step function for a player, and spread that depends only on the shooter

**Files:**
- Modify: `src/sim/world.js`, `src/sim/weapons.js`
- Test: `tests/weapons.test.mjs`, `tests/world.test.mjs`

**Interfaces:**
- Consumes: Task 1's `shots` field.
- Produces:
  - `tickClock(world, dt)`: `prevPoses = poses; t += dt; tick++; poses = posesAt(system, t)`. `stepWorld`
    starts with it. The browser never computes `t` from `tick * TICK`; it starts from the server's `t` and
    adds `dt`, so both clocks give the same floats.
  - `stepPlayer(world, e, input, dt)`: today's per-entity block of `stepWorld` (set `prev`, `stepEntity`,
    `stepHook`, weapon pick, `fire(world, e, input.lag || 0)` when `input.fire`, `touchPads`).
  - `fire(world, e, lag = 0)`: each projectile gets `id: \`${e.id}.${e.shots}.${k}\`` (k = pellet index)
    and `lag`; `e.shots` goes up by one per shot (after the pellets). Spread draws from
    `shotRand(id, shots, k)`, a pure hash of the three (no `world.rand`), so the browser predicting your
    shot draws the same pellets as the server. Railgun beams get `id` too.

- [ ] **Step 1: Write the failing tests**

```js
// weapons.test.mjs
test("spread depends only on who fires and which shot: the world's random numbers don't change it", () => {
  // two range(25, "minigun") setups; in one, call w.rand() 7 times before each shot.
  // Fire 20 shots in each: projectile vels deepEqual; ids "player.0.0" .. "player.19.0"; more than one distinct vel.
});
test("shotgun pellets of one shot share the shot number and differ by pellet", () => {
  // one shotgun shot: ids "player.0.0" .. "player.0.9"; p.shots === 1.
});
// world.test.mjs
test("stepPlayer on a bare clock gives exactly what stepWorld gives", () => {
  // w1 = padless createWorld, w2 = a copy made the same way. 120 ticks of a scripted input
  // (run 40, jump, boost 30, hook held 30) through stepWorld(w1) and through tickClock(w2) + stepPlayer(w2, p2)
  // (dummy parked out of the way and every pickup's readyAt set to Infinity in both, so stepWorld's
  // extra work can't touch the player). deepEqual pos, vel, up, forward of the two players.
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/weapons.test.mjs tests/world.test.mjs`
Expected: FAIL (`tickClock` not exported; ids undefined).

- [ ] **Step 3: Implement `tickClock`, `stepPlayer`, `shotRand`, projectile ids and `lag` on projectiles**

`shotRand`: hash the string `${id}|${shots}|${k}` to 32 bits (e.g. FNV-1a), seed the same LCG as
`seeded`, take two numbers.

- [ ] **Step 4: Run the whole suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS ("the same seed fires the same spread" still holds: same shooter, same shots).

- [ ] **Step 5: Commit** (`One step function per player; spread from the shooter and shot number`)

---

### Task 3: Lag compensation

**Files:**
- Create: `src/sim/lag.js`
- Modify: `src/sim/weapons.js`, `src/sim/world.js`
- Test: `tests/lag.test.mjs` (new)

**Interfaces:**
- Consumes: Task 2's `lag` on projectiles and `fire(world, e, lag)`.
- Produces:
  - `record(world)`: called at the end of `stepWorld`; appends `{ t, ents: { id: rec } }` to
    `world.history` and drops entries older than `NET.history` s. `rec = { pos, up, groundId, rel }`,
    `rel = groundId ? sub(pos, poses[groundId].pos) : null`.
  - `placeRec(rec, poses) -> feet`: `rec.groundId && poses[rec.groundId] ? add(poses[groundId].pos, rel) : rec.pos`.
    Where an entity is drawn: grounded ones ride their body at its current pose (the browser draws
    bodies at its own, later time; see Task 8). Shared by the server's rewind and the browser's drawing.
  - `seenCentre(world, e, lag) -> centre`: with `lag <= 0`, no history, or no record of `e`, `hitCentre(e)`;
    else `lag = min(lag, NET.maxLag)`, the two records around `t - lag` interpolated (`rel` when both are
    on the same body, else `pos`; on a switch, the later record), placed with `world.poses`, plus
    `up * PLAYER.radius`.
  - `stepProjectiles`: tests other entities at `seenCentre(world, e, p.lag)`, the owner at `hitCentre`.
    `rail(world, e, eye, dir, spec, lag)` likewise. `explode(world, pos, ownerId, lag = 0)`: distance and
    push direction from `seenCentre` for everyone but the owner; the push is added to the current `vel`.
  - Hit events: `{ type: "hit", id, damage, by, from }`, `from` the shooter's eye (bullets, rail) or the
    blast centre.
  - Cosmetic worlds (the browser's view, Task 7): `world.cosmetic = true` makes `hurt` do nothing and
    `explode` push only `world.selfId`, calling `world.onSelfPush?.(dv)` with the push it gave. Pellet
    pushes are skipped. Projectiles still stop where they hit.

- [ ] **Step 1: Write the failing tests in `tests/lag.test.mjs`**

```js
// Setup: online world, players a (shooter, floating at [0, 150, 0] looking +x) and b (target, floating,
// moving at [0, 0, 10] m/s, health 1e9), stepped 40 ticks so history exists.
test("a railgun shot where the shooter saw the target hits with the shooter's lag, and misses without it", () => {
  // aim a's view at seenCentre(w, b, 0.1); fire(w, a, 0.1) -> a hit event on b.
  // same aim, fire(w, a, 0) (cooldown reset) -> no hit event on b (b has moved 1 m).
});
test("a bullet passing through where the target was seen hits; without lag the same path misses", () => {
  // push a projectile { kind: "pistol", owner: "a", lag: 0.1, pos: P - 2x, vel: 120x } where
  // P = seenCentre(w, b, 0.1); stepProjectiles(w, TICK) twice -> hit on b. Same with lag: 0 -> no hit.
});
test("a target standing on a moving planet is rewound relative to the planet", () => {
  // b stands on mid; step 30 ticks; rel0 = rel of b's record from 0.2 s ago.
  // seenCentre(w, b, 0.2) equals add(w.poses.mid.pos, rel0) + up * radius (within 1e-9),
  // and differs from the old world position by more than 0.5 m (the planet moved).
});
test("a rocket under the seen feet throws the target as hard as the shooter saw", () => {
  // explode at placeRec of b's record 0.1 s ago, lag 0.1: b's speed change >= 0.9 * ROCKET.knockback * (1 - r/splash)
  // (r = PLAYER.radius); the same explosion with lag 0 pushes b less.
});
test("lag is capped at NET.maxLag", () => {
  // seenCentre(w, b, 5) deepEqual seenCentre(w, b, NET.maxLag).
});
test("hit events say who hit and from where", () => {});
test("in a cosmetic world nobody is hurt, and a blast pushes only you", () => {});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/lag.test.mjs`
Expected: FAIL (`src/sim/lag.js` doesn't exist).

- [ ] **Step 3: Implement `src/sim/lag.js` and the weapon changes**

- [ ] **Step 4: Run the whole suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (solo shots have `lag` 0, so nothing else changes).

- [ ] **Step 5: Commit** (`Lag compensation: hits judged where the shooter saw the target`)

---

### Task 4: The protocol

**Files:**
- Create: `src/net/protocol.js`
- Test: `tests/protocol.test.mjs` (new)

**Interfaces:**
- Produces:
  - `PROTOCOL = 1`.
  - Messages (JSON). Browser to server: `{ type: "hello", v, name, token? }`,
    `{ type: "input", tick, view, input }`. Server to browser: `{ type: "welcome", id, token, tick, t,
    colour }`, `{ type: "full" }`, `{ type: "version" }`, and snapshots (below).
  - `cleanInput(raw) -> { ...NO_INPUT fields, tick, view } | null`: null unless `raw` is an object with a
    finite integer `tick`. `move` entries: finite numbers clamped to [-1, 1], else 0. Booleans only when
    `=== true`. `weapon` only if in `WEAPON_ORDER`, else null. `yawDelta`, `pitchDelta`: finite, clamped to
    [-PI, PI], else 0. `view`: finite and `<= tick`, else `tick`.
  - `cleanName(raw, taken) -> string`: `String(raw ?? "")`, control characters removed, spaces collapsed,
    trimmed, cut to `NET.nameMax`; empty becomes `"Player"`; if `taken` (array) has it, ignoring case, add
    `" 2"`, `" 3"`, ... (cutting the base so the result stays within `NET.nameMax`).
  - `entityState(e) -> rec`: a JSON-safe copy of every field but `prev`, with `-Infinity`/`Infinity`
    written as the strings `"-inf"`/`"inf"`; `applyEntity(e, rec)` reverses it onto `e` (clears `prev`).
  - `snapshot(world, { tick, ack, slack, events }) -> { type: "snap", tick, t, ack, slack, entities:
    [rec], shots: [{ id, kind, owner, pos, vel }], pickups: { id: readyAt }, players: { id: { name, colour,
    kills, deaths } }, beams, events }`. `tick` and `t` are the world's.

- [ ] **Step 1: Write the failing tests**

```js
test("cleanInput keeps good input and repairs or rejects the rest", () => {
  // a full good input round-trips unchanged.
  // { tick: 5, move: [NaN, 9], yawDelta: Infinity, pitchDelta: "1", fire: "yes", weapon: "bfg" }
  //   -> move [0, 1], yawDelta 0, pitchDelta 0, fire false, weapon null.
  // null, "x", {}, { tick: 1.5 }, { tick: NaN } -> null.
});
test("cleanName trims, cuts and numbers duplicates", () => {
  // "  Ana  " -> "Ana"; "" -> "Player"; "a\u0000b" -> "ab"; 40 x "x" -> 16 x "x";
  // cleanName("ana", ["Ana"]) -> "ana 2"; cleanName("Ana", ["Ana", "Ana 2"]) -> "Ana 3";
  // cleanName("x".repeat(16), ["x".repeat(16)]).length <= 16.
});
test("an entity survives a JSON round trip exactly, -Infinity included", () => {
  // e from a solo world after 200 ticks of running and a rocket hit (lastHitAt finite) and a fresh one
  // (lastHitAt -Infinity, padLockUntil -Infinity): applyEntity(createEntity(...), JSON.parse(JSON.stringify(entityState(e))))
  // deepEqual e without prev.
});
test("a snapshot has every entity, shot, pickup and player, and survives JSON", () => {});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/protocol.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/net/protocol.js`**

- [ ] **Step 4: Run them**

Run: `node --test tests/protocol.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit** (`The protocol: messages, cleaning, snapshots`)

---

### Task 5: The game room on the server

**Files:**
- Create: `server/game.js`
- Test: `tests/game.test.mjs` (new)

**Interfaces:**
- Consumes: Task 1 (`createWorld`, `addPlayer`, `removePlayer`), Task 2 (`stepWorld`), Task 4.
- Produces: `createGame(tuning, { token = () => randomUUID() } = {})` returning:
  - `hello(conn, msg) -> reply`: wrong `v`: `{ type: "version" }`. A `token` held in the reconnect list
    and not in use: the same id, name, colour and score, a fresh spawn, no death counted. Otherwise, with
    `NET.maxPlayers` already in: `{ type: "full" }`. Otherwise a new player: id `"p" + n` (n counts up per
    game), `cleanName` against current names, the first unused colour from `COLOURS[1..]`. Creates the
    world if there is none. Reply `{ type: "welcome", id, token, tick, t, colour }`.
  - `input(conn, raw)`: `cleanInput`; dropped if null, for an unknown conn, older than the last applied
    tick by more than `NET.maxAhead`, or newer than the world's tick by more than `NET.maxAhead`. Kept by tick.
  - `drop(conn)`: removes the body at once (`removePlayer(..., { keepScore: true })`), keeps
    `{ id, name, colour, score }` under the token for `NET.rejoin` s of game-room time.
  - `step() -> [{ conn, msg }]`: one tick. Each player's input: the one for this tick; inputs for earlier
    ticks that arrived late are merged into it (their `jump` OR'ed, `weapon` kept if this one has none,
    `yawDelta`/`pitchDelta` summed), so a late press or turn is never lost. No input: the last input's held
    fields (`move`, `boost`, `fire`, `hook`, `zoom`) for up to `NET.hold` ticks, then `NO_INPUT`. `lag =
    clamp((tick - view) * TICK, 0, NET.maxLag)`. Then `stepWorld`. Every `NET.snapEvery` ticks, one
    snapshot per connection with `ack` (the newest tick applied from a real input of that player) and
    `slack` (newest input tick received minus the world's tick) and the events since the last snapshot.
    Expired reconnect entries are dropped; with nobody connected and none left, the world is thrown away.
  - `world` (or null) and `players()` (connected count) for tests and logs.

- [ ] **Step 1: Write the failing tests in `tests/game.test.mjs`**

```js
// Helpers: hi(g, conn, name) = g.hello(conn, { type: "hello", v: PROTOCOL, name });
// inp(tick, extra) = { tick, view: tick - 6, input: { ...NO_INPUT, ...extra } }; steps(g, n).
test("the first hello gets a welcome with an id, token, tick and t, and a fresh world", () => {});
test("a ninth player is told the game is full", () => {});
test("a wrong protocol version is told to reload", () => {});
test("same names get numbers, and each player gets a colour nobody else has", () => {});
test("an input is applied at its tick; a late one's jump and turn are not lost", () => {
  // player standing; deliver input for tick T+1 with jump after step T+1 ran, input T+2 without jump:
  // after step T+2 the player is in the air; yaw summed (forward turned by both deltas).
});
test("with no inputs a player keeps their held keys for NET.hold ticks, then lets go", () => {
  // input with fire: true at tick T, nothing after: shots fired stop after NET.hold ticks (count projectiles by owner).
});
test("dropped: the body leaves at once; back within 10 s with the token: same id, same score, no death", () => {});
test("after 10 s the token is forgotten: a new player at 0/0", () => {});
test("the same token on two connections: the second gets a new player", () => {});
test("when the last player is gone and the reconnect window is over, the game resets", () => {
  // play, take a pickup, score a kill; drop all; step NET.rejoin s; new hello: tick 0, t 0, every pickup
  // ready, scores 0/0, id "p1".
});
test("snapshots every 2 ticks carry ack, slack and the events since the last one", () => {});
test("garbage never crashes the room or puts NaN into the world", () => {
  // input(conn, x) for x in [null, 1, "s", {}, { tick: "1" }, { tick: 1, input: { move: [NaN, NaN], yawDelta: 1e308 } }],
  // input for an unknown conn, hello with name { a: 1 }; then 60 steps: no throw, no NaN in any entity.
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/game.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `server/game.js`** (imports only `src/` modules and `node:crypto`)

- [ ] **Step 4: Run the whole suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Commit** (`The game room: joining, inputs, snapshots, reconnects and resets`)

---

### Task 6: The server process

**Files:**
- Create: `server/server.js`, `server/package.json` (`"type": "module"`, dependency `"ws": "8.18.0"`),
  `server/package-lock.json` (from `npm install`), `tools/net_smoke.mjs`
- Modify: `.gitignore` (`node_modules/`)

**Interfaces:**
- Consumes: Task 5's `createGame`.
- Produces: `node server/server.js` listens on `process.env.PORT || 8787` on all interfaces. Each
  connection gets a conn id; messages are `JSON.parse`d in a try (bad JSON ignored), routed to
  `hello`/`input`; a `hello` reply of `full` or `version` is sent and the socket closed. Ticks run from
  real elapsed time like `advance` (at most `MAX_TICKS` per wake, the rest dropped), woken every few ms by
  `setTimeout`. Logs: start, port, player counts on join and leave, never names.

- [ ] **Step 1: Write `tools/net_smoke.mjs`**: connects two clients with Node 22's built-in `WebSocket`
  to `ws://localhost:8787`, says hello, sends 60 ticks of empty input each, and prints `OK` when both have
  a welcome and a snapshot with two players, else the reason and exit code 1.

- [ ] **Step 2: Run it without a server and watch it fail**

Run: `node tools/net_smoke.mjs`
Expected: a connection error, exit code 1.

- [ ] **Step 3: Implement `server/server.js` and `server/package.json`; `cd server && npm install`**

- [ ] **Step 4: Start the server in the background and run the smoke check**

Run: `node server/server.js` (background), then `node tools/net_smoke.mjs`
Expected: `OK`. Then stop the server.

- [ ] **Step 5: Commit** (`The server process on WebSockets`)

---

### Task 7: Predicting your own player

**Files:**
- Create: `src/net/predict.js`
- Test: `tests/predict.test.mjs` (new)

**Interfaces:**
- Consumes: Task 2 (`tickClock`, `stepPlayer`), Task 3 (cosmetic worlds), Task 4 (`applyEntity`),
  Task 5 (for the agreement test).
- Produces: `createPrediction(view, id)` where `view` is a cosmetic online world (`cosmetic = true`,
  `selfId = id`); returns:
  - `start(tick, t)`: sets `view.tick`, `view.t`, poses; clears stored inputs and pushes.
  - `step(input)`: `tickClock(view, TICK)`, `stepPlayer(view, me, input, TICK)` if `me` is alive (your
    own shots go into `view.projectiles` with `mine: true`), stores `{ input, t }` by tick and any self
    push from `onSelfPush` by tick.
  - `reconcile(snap)`: if the snapshot's own record is dead or missing, adopt it. Else, from the
    snapshot's tick and `t`, rebuild `me` with `applyEntity` and replay the stored inputs for ticks after
    it up to `view.tick` on a scratch clock (no shots spawned, stored self pushes re-added at their ticks),
    then add the difference between the old and new drawn position to a visual offset. Inputs at or before
    the snapshot tick are dropped. If `view.tick - snap.tick > NET.resync` or `view.tick < snap.tick`, call
    `start(snap.tick + NET.lead, …)` instead (a hidden tab came back).
  - `offset() -> vec`: the visual correction, decaying to zero over `NET.smooth` s; an error over
    `NET.snap` m is not smoothed (snap).
  - `me` (the predicted entity).

- [ ] **Step 1: Write the failing tests**

```js
test("server and browser compute the same player from the same inputs", () => {
  // createGame; hello "a"; view + prediction started at welcome.tick + NET.lead with t advanced to match
  // (step a scratch clock NET.lead times from welcome.t).
  // 300 ticks of a scripted input (run, jump, boost, turn, hook, fire pistol): each tick, prediction.step(inp)
  // and game.input(conn, { tick: view.tick, view: view.tick - 6, input: inp }); step the game until its tick
  // catches up. Compare the predicted player at tick T with the server's at tick T: deepEqual pos, vel, up,
  // forward, pitch, fuel, weapon, shots.
});
test("a correction replays the inputs since the snapshot", () => {
  // predict 20 ticks; build a snapshot of tick 10 whose player got +5 m/s sideways;
  // reconcile -> me equals a copy stepped from that state with inputs 11..20.
});
test("your rocket jump is predicted and survives a correction from before the blast", () => {});
test("small corrections are smoothed away within NET.smooth s; big ones snap", () => {});
test("a snapshot far ahead or behind resyncs the clock instead of replaying minutes", () => {});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/predict.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/net/predict.js`**

- [ ] **Step 4: Run the whole suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Commit** (`Own-player prediction and correction`)

---

### Task 8: Drawing the others in the past

**Files:**
- Create: `src/net/interp.js`
- Test: `tests/interp.test.mjs` (new)

**Interfaces:**
- Consumes: Task 3 (`placeRec`), Task 4 (snapshot records).
- Produces: `createInterp()` returning:
  - `push(snap)`: keeps snapshots by tick (about one second's worth).
  - `newest()`: the newest snapshot tick.
  - `sample(tick) -> { entities: { id: rec }, shots: [...] }` for a fractional tick: the records of the
    two snapshots around it, interpolated: grounded on the same body, `rel` is interpolated (so they stay
    on the surface when drawn with `placeRec` on the view's poses); otherwise `pos`; `up` and `forward`
    normalised lerps; on a ground/air switch, the later record. An entity missing from the later snapshot
    is gone. Shots by id, `pos` interpolated, new ones from the later snapshot as they are.
    Before the oldest snapshot: the oldest; after the newest: the newest (no guessing ahead).
  - The view tick for others is `newest() - NET.interp` (fractional, advanced with real time between
    snapshots, nudged back towards that target); it is what inputs send as `view`.

- [ ] **Step 1: Write the failing tests**

```js
test("halfway between two snapshots, a floating player is halfway", () => {});
test("a player standing on a moving planet stays on its surface when drawn on the browser's later poses", () => {
  // two snapshots 2 ticks apart of a player on mid; sample at +1; placeRec(rec, posesAt(system, t + 0.15)):
  // |dist(feet, mid centre) - radius| < 1e-6.
});
test("on a ground or air switch, the later record wins", () => {});
test("a player missing from the later snapshot is gone", () => {});
test("shots are interpolated by id", () => {});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/interp.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `src/net/interp.js`**

- [ ] **Step 4: Run them**

Run: `node --test tests/interp.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit** (`Other players and shots drawn smoothly in the past`)

---

### Task 9: The browser online: connection, clock and modes

**Files:**
- Create: `src/client/net.js`, `src/client/online.js`, `src/client/config.js`
- Modify: `src/client/main.js`, `src/client/hud.js`, `index.html`
- Test: `tests/online.test.mjs` (new)

**Interfaces:**
- Consumes: Tasks 4, 7, 8.
- Produces:
  - `config.js`: `export const SERVER = "wss://planet-arena.fly.dev";` (the Fly.io app name is the
    owner's to confirm at deploy; changing it is this one line).
  - Mode: online when `?server=<ws url>` is given or the page is served from `*.github.io` (then
    `SERVER`); `?solo` forces solo; otherwise solo (today's page, unchanged).
  - `connect(url, { onMessage, onStatus }) -> { send(msg), close() }` in `net.js`: statuses
    `"connecting"`, `"open"`, `"unreachable"` (after `NET.unreachable` s of failed tries), `"closed"`;
    retries every 1 to 2 s; sends `hello` (with the stored token) on every open.
  - `createOnlineGame(tuning, url, name)` in `online.js`: owns the view world (cosmetic, `selfId` = own id),
    the prediction, the interpolation and the connection. `frame(elapsed, take)` runs client ticks for
    real elapsed time, plus or minus one tick per snapshot from `clockNudge(slack)`; each tick takes one
    input, sends `{ type: "input", tick, view, input }` and predicts; then it fills the view from
    `sample(viewTick)` (others via `placeRec` on the view's poses, others' shots, pickups' `readyAt`,
    players and scores, events for the HUD), steps own `mine` shots with `stepProjectiles` (cosmetic, so
    they stop where they hit), and runs `refreshCues(view)`. Server events for your own shots' blasts and
    beams are skipped when you already drew them (matched by shot id). `status` and `full`/`version`
    outcomes for the HUD. The token lives in `sessionStorage`, the name in `localStorage`
    (`planet-arena-name`), both in try/catch.
  - `clockNudge(slack) -> -1 | 0 | 1` (pure, exported): +1 (run an extra tick) below `NET.slack[0]`,
    -1 (skip one) above `NET.slack[1]`, else 0.
  - `main.js`: in online mode, before the game, a name box (prefilled from `localStorage`) and a Play
    button; then the status screens: "Starting the server..." (connecting), "Can't reach the server, still
    trying" (unreachable), "The game is full", "A new version is out: reload the page". The renderer and
    HUD read the view world with `selfId`. `?debug` exposes `window.game = { world }` with the view world.

- [ ] **Step 1: Write the failing tests in `tests/online.test.mjs`**

```js
test("clockNudge speeds up when inputs arrive late, slows down when far ahead", () => {
  // clockNudge(NET.slack[0] - 1) === 1; clockNudge(NET.slack[1] + 1) === -1; in range 0.
});
test("a browser and the room, joined in memory, agree and see each other", () => {
  // createOnlineGame with a fake connect (messages passed straight to a createGame room) for two players,
  // 300 frames of 1/60 s with the room stepped in time: each view has both players; each own predicted
  // player is within 1e-6 m of the room's at the same tick.
});
```

  (`createOnlineGame` takes an optional `connectFn` so the test can pass the in-memory connection.)

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/online.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `net.js`, `online.js`, `config.js` and the `main.js`/`hud.js`/`index.html` changes**

- [ ] **Step 4: Run the suite, then the page against a local server**

Run: `node --test 'tests/*.test.mjs'`, then with `python3 -I tools/serve.py 8100` and
`node server/server.js` running: the page check with
`"http://localhost:8100/?server=ws://localhost:8787&debug"` (the check may need to click Play; extend
`tools/page_check.cjs` with an optional name to type) and plain `"http://localhost:8100/?debug"`.
Expected: PASS; `OK` for both (solo unchanged).

- [ ] **Step 5: Commit** (`The browser online: connection, clock, name and status screens`)

---

### Task 10: Seeing players, hits, kills and scores

**Files:**
- Modify: `src/client/render.js`, `src/client/hud.js`, `src/client/main.js` (Tab held shows the scores;
  its keydown is prevented so focus stays on the game), `index.html`
- Test: `tests/hud.test.mjs` (new)

**Interfaces:**
- Consumes: Task 1 (death events, scores, players), Task 3 (hit events), Task 9 (view world).
- Produces:
  - Renderer: `createRenderer(world, canvas, fixedView, selfId = "player")`. Every entity but yourself is
    drawn: players as today's capsule in their colour, the dummy orange. Above each: a sprite with the name
    (the dummy's is "Dummy") and a health bar, with depth testing (hidden behind bodies) and distance
    scaling; the bar flashes white for 0.15 s on a hit event for that entity. Death blasts from
    `world.explosions` (Task 1) draw like rocket blasts.
  - HUD: the top-right dummy bar goes (the dummy has its bar overhead). New: a red vignette on your own hit
    events (opacity grows with damage, fades over about 0.4 s); a red arc around the crosshair towards the
    hit's `from`, fading over about 1 s; your kills/deaths in a corner (online); a kill feed line per death
    in the top corner for about 5 s; the scoreboard while Tab is held; killer text ("Sun kill!" for the
    sun, "Kill!" otherwise); victim text with "(by Name)" when there is a killer.
  - Pure, exported from `hud.js`: `scoreRows(players) -> [{ id, name, kills, deaths }]` (most kills first,
    fewer deaths breaks ties, then name); `feedText(ev, players) -> string` ("Ana ☀ Ben" for the sun,
    "Ana ✹ Ben" for damage, "Ana ⋯ Ben" for the void, the victim's name alone with no killer);
    `arcAngle(camera, from) -> radians` given `{ pos, right, up, forward }` (0 = straight up on screen,
    clockwise positive; a source behind you still gets a side).
  - Names are put into the page with `textContent`, never `innerHTML`.

- [ ] **Step 1: Write the failing tests**

```js
test("scoreRows: most kills first, fewer deaths breaks ties", () => {});
test("feedText names killer and victim with a mark per cause", () => {});
test("arcAngle points the arc at the shooter: right is +PI/2, behind-left is near -PI/2 .. -PI", () => {});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/hud.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement the renderer and HUD changes**

- [ ] **Step 4: Run the suite and the page checks; take screenshots**

Run: `node --test 'tests/*.test.mjs'`; page check solo and online (two pages against a local server,
Task 11's tool once it exists, or two runs of the page check), screenshots to `shots/`.
Expected: PASS, `OK`; screenshots show the other player with name and bar.

- [ ] **Step 5: Commit** (`Other players' names and bars, hit flashes, kill feed and scores`)

---

### Task 11: The two-browser check, deployment files and docs

**Files:**
- Create: `tools/net_check.cjs`, `Dockerfile`, `.dockerignore`, `fly.toml`, `.nojekyll`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `tools/net_check.cjs <page url with ?server=…&debug> [shots dir]`: two Playwright pages, each types a
    name and plays; prints `OK` when both views have two players, neither has page errors, and each view's
    clock keeps real time; saves a screenshot per page.
  - `Dockerfile`: `node:22-alpine`; copies `src/tuning.js`, `src/sim/`, `src/net/`, `server/`; `npm ci
    --omit=dev` in `server/`; `CMD ["node", "server/server.js"]`; `ENV PORT=8080`.
  - `fly.toml`: app `planet-arena` (owner confirms), `primary_region = "fra"`, `[http_service]`
    `internal_port = 8080`, `force_https = true`, `auto_stop_machines = "stop"`, `auto_start_machines =
    true`, `min_machines_running = 0`; one shared-cpu-1x 256 MB machine.
  - README: how to play online, how to run the server locally, how to deploy (owner steps below).
    CLAUDE.md: the local server command, the net check, the `src/net/` rule.

- [ ] **Step 1: Run `tools/net_check.cjs` before it exists and watch it fail**

Run: `node tools/net_check.cjs "http://localhost:8100/?server=ws://localhost:8787&debug" shots`
Expected: module not found.

- [ ] **Step 2: Write `tools/net_check.cjs`; run it with both local servers up**

Expected: `OK`, two screenshots.

- [ ] **Step 3: Write the deployment files and docs.** If Docker is installed, `docker build .` must
  succeed; if not, say so in the ledger.

- [ ] **Step 4: Run the whole suite and both page checks**

Run: `node --test 'tests/*.test.mjs'`, the solo page check, `tools/net_check.cjs`.
Expected: PASS, `OK`, `OK`.

- [ ] **Step 5: Commit** (`Two-browser check, Fly.io and Pages files, docs`)

---

## After the plan (with the owner, not part of the build)

Each step is outward-facing; do it only when the owner says so.

1. The owner creates a personal Fly.io account, adds a card, installs `flyctl` and logs in.
2. `fly launch --no-deploy` with the existing `fly.toml` (confirm the app name; update `config.js` if it
   differs), then `fly deploy`.
3. Push `main` to GitHub; turn on GitHub Pages (branch `main`, root).
4. Play-test with the friends; tune from what they say.
