# Planet Arena

A physics arena shooter across a small solar system, in the browser. Spec:
`docs/superpowers/specs/2026-10-25-planet-arena-design.md`.

- Run: `python3 -I tools/serve.py 8100`, open `http://localhost:8100`.
- Tests: `node --test 'tests/*.test.mjs'` (Node 22; the glob is quoted so Node expands it).
- Page check (server running): `NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/page_check.cjs "http://localhost:8100/?debug" shots/start.png`
  prints `OK` when the page has no errors and the clock keeps real time. `?view=x,y,z,tx,ty,tz` fixes a free
  camera for screenshots; `?debug` exposes `window.game = { world }`.
- Controls: click to capture the mouse; mouse look, WASD move, space jump (held in the air: booster),
  left mouse fire, 1 pistol, 2 rocket launcher, wheel cycles.

## Constraints

- Desktop browser from a link, no install; keyboard and mouse.
- Plain ES modules, three@0.160.0 from the import map in `index.html`; no bundler, no npm dependencies in
  the page. Local checks may use Playwright through `npx`.
- Every gameplay number lives in `src/tuning.js`. When a property test fails, change the numbers, never
  the test's property.
- `src/sim/` imports nothing from three.js or the DOM, so a server can run the same code later.
  `src/client/` draws the world and turns keyboard and mouse into input records.
- Orbits are scripted from the match clock, never simulated. Fixed tick 1/60 s.
- Simple, cartoonish look; own assets only.
- Docs and comments: brief, explain why; no em dashes.
