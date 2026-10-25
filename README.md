# Planet Arena: prototype

A single-player prototype of a physics arena shooter across a small solar system: one sun, three
planets, a moon and a station. Every body has its own gravity. Blast the dummy off the tiny green planet
and watch it fall into the sun.

## Start it

```
python3 -I tools/serve.py 8100
```

Then open http://localhost:8100 in a desktop browser and click the page to capture the mouse
(Esc lets it go).

## Controls

| Key | Does |
|---|---|
| Mouse | Look |
| W A S D | Run |
| Space | Jump; in the air, hold it to fire the booster (after a jump, let go and press again) |
| Left mouse | Fire |
| 1 / 2 / wheel | Pistol / rocket launcher |

- The bar bottom left is the booster's fuel. It refills while you stand on anything.
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
| Pad launch speed and direction | `PADS` (re-run the tests: pads must keep their launch windows) |

Things worth knowing:

- Gravity weakens with height from right at a body's surface, so high jumps and rocket jumps feel
  floaty (a rocket jump on the heavy planet climbs about 20 m). Raising a planet's `reach` above its
  `radius` keeps the full pull for longer, which makes jumps snappier.
- Near a body only that body pulls (its `hold`). Without that, the sun would drag an ordinary jump off the
  tiny planet.

## For the first playtest

- Does running feel fast enough?
- Are jumps and the booster right?
- Is the sun kill satisfying?
- Are the pad windows too rare?
