# Planet Arena: prototype

A prototype, playable alone or online with friends, of a physics arena shooter across a small solar system: one sun, five planets
and a moon. Every body has its own gravity. Blast the dummy off the tiny green planet and watch it fall
into the sun.

From the sun outwards: the hot red planet (close to the sun, so watch your footing), the tiny green
planet, the mid blue planet where you start, the asteroid belt, the big heavy orange planet with its
moon, the light purple giant with its ring, and the small teal far planet, where the sniper rifle is.

Four comets loop round the sun on tilted, stretched paths, fast near the sun and slow far out. Fly into
one (or let it sweep into you) and you land on it; ride it, and jump off when it passes near a planet.
The two fast comets pass the hot and tiny planets often, but hopping off near the sun takes good
boosting. The slow one passes the heavy or giant planet every few minutes, where a plain jump gets you
off. The fourth swings out to almost 400 m, past the far planet's path, on a 14-minute lap. Stay on too
long and any of them carries you close to the sun.

The asteroid belt between the mid and heavy planets' paths and the giant's ring are scenery: you fly
straight through them.

## Start it

```
python3 -I tools/serve.py 8100
```

Then open http://localhost:8100 in a desktop browser and click the page to capture the mouse
(Esc lets it go).

## Play online

Open the game from the hosted page (GitHub Pages) and type a name; you join the shared match. To use another
server, add `?server=ws://host:port` to the page address; `?solo` forces the single-player version. Several
players share one solar system and one match clock; kills and scores show in the kill feed.

## Run the server locally

```
cd server && npm install && cd ..
node server/server.js            # listens on port 8787 (PORT overrides)
python3 -I tools/serve.py 8100
```

Open `http://localhost:8100/?server=ws://localhost:8787` in two windows. The server runs the same `src/sim/`
code as the browser, so both agree on the rules.

To check two browsers at once (Playwright through `npx`, both servers running):
`node tools/net_check.cjs "http://localhost:8100/?server=ws://localhost:8787&debug" shots` prints `OK`.

## Deploy

Nothing here is automatic; each step is the owner's.

1. Create a personal Fly.io account, add a card, install `flyctl` and log in.
2. `fly launch --no-deploy` (keep the existing `fly.toml`; the app name must be free, and if it differs,
   change `SERVER` in `src/client/config.js`), then `fly deploy`. The machine stops when idle and starts on
   the first connection, so the first join after a quiet spell takes a few seconds.
3. Push `main` to GitHub and turn on Pages (branch `main`, root). `.nojekyll` keeps Pages from rebuilding the files.

## Controls

| Key | Does |
|---|---|
| Mouse | Look |
| W A S D | Run |
| Space | Jump; in the air, hold it to fire the booster (after a jump, let go and press again) |
| Left mouse | Fire |
| Right mouse | Hook: hold to pull yourself to the planet, moon or comet you aim at (25 m); let go to fly on |
| 1 to 6 / wheel | Pistol, shotgun, rocket launcher, minigun, sniper rifle, railgun (the wheel skips ones you don't hold) |
| Shift | Zoom, with the sniper rifle |

- Bottom left: your health (your own rockets hurt you too), the weapons you hold, the one in hand with its
  ammo, and the booster's fuel, which refills while you stand on anything. A full booster burn adds 18 m/s,
  more than it takes to leave most planets, so boost with care. Extra fuel from a pickup shows in blue.
- The crosshair gets a ring when the hook can catch something.
- You start with the pistol, which never runs out. Pickups float over fixed spots on every planet and the
  moon: health (white with a red cross), booster fuel (orange, fills the tank to double), weapons (long
  bars) and ammo (small boxes, in the weapon's colour). A taken pickup comes back after a while; its spot
  shows a faint outline meanwhile. The sniper rifle is on the far planet and the railgun on the hot planet. Dying
  costs you everything but the pistol.
- Jump pads are the discs with an arrow. Green means a launch right now lands on another body; red means
  it won't. Stand near one to see the predicted path.
- The dummy (orange, with a face) lives on the tiny green planet and comes back 3 s after it dies.

## Tuning

Every gameplay number is in `src/tuning.js`. After a change, run `node --test 'tests/*.test.mjs'`: the
tests check that the system still plays right (jumps come back down, the sun kill works, the booster can
save you, pads have launch windows).

| To change | Edit |
|---|---|
| Running speed and grip | `PLAYER.run`, `PLAYER.accel`, `PLAYER.friction` |
| Jump height | `PLAYER.jump`, and each body's `g` |
| How fast the view turns as "down" changes | `PLAYER.upTurn` |
| Booster strength and fuel | `BOOST.accel`, `BOOST.fuel`, `BOOST.refill` |
| Mouse sensitivity | `CONTROLS.mouse` |
| Rocket blast (and so the sun kill and rocket jumps) | `ROCKET.knockback`, `ROCKET.splash`, `ROCKET.damage` |
| How strong a body is | its `g` (pull at the surface) and `reach` (how far the full pull lasts) in `BODIES` |
| Where a body's own pull shields you from the sun | its `hold` in `BODIES` (metres above the surface) |
| Orbit speed | `orbit.period` in `BODIES` (seconds per lap) |
| Pad launch speed and direction | `PADS` (re-run the tests: pads must keep their launch windows; a pad needs to be faster than it takes to leave its planet) |

Things worth knowing:

- Planets and the moon keep their full pull up to 1.75 times their radius (`reach`), so a rocket blast
  rarely throws you off the mid, heavy or giant planet. The tiny planet still throws you, mostly into the
  sun.
- A body's overall pull grows with `g` times `reach` squared. The sun has to outweigh the planets for
  things knocked loose to fall into it, which is why it is big; raising a big planet's `g` or `reach` can
  make it pull harder than the sun.
- Near a body only that body pulls (its `hold`). Without that, the sun would drag an ordinary jump off the
  tiny planet.

## For the first playtest

- Does running feel fast enough?
- Are jumps and the booster right?
- Is the sun kill satisfying?
- Are the pad windows too rare?

## Licence

MIT, see `LICENSE`.
