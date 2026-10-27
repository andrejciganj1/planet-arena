# Comets and rings: design

Date: 2026-10-27. Status: for the owner's review. Extends `2026-10-25-planet-arena-design.md` (the main
spec), whose constraints all still hold.

## Intent

The owner wants the solar system to look and feel more alive. Three additions:

- **Comets** you can ride. A comet swings past on a long, stretched path; a player drifting in space
  can bump into it, land on it and ride along, then jump off when it passes near a planet. The owner's
  words: "it would look cool, and a player can bump into a comet while in space ... maybe you take a ride
  and then if you come near another planet you can jump off."
- **An asteroid belt**: one loose band of rocks circling the sun between two planets' paths. For looks
  only.
- **A ringed planet**: one planet gets a flat ring like Saturn's. For looks only.

Success: in the prototype, the owner can catch a comet (by booster, or because it sweeps into them),
ride it, and hop off onto a planet; and the system looks richer with the belt, the ring and the comets'
tails. Catching one with a jump pad launch is a lucky bonus, not something the layout promises.

## Goals

- Comets are a new way to travel and a new risk, not a gimmick: catching one and timing the jump off is
  a skill, like timing a jump pad.
- The comets, the belt and the ring read clearly from anywhere in the system.

## Non-goals

- The belt's rocks and the planet's ring have no collisions and no gravity. You fly straight through
  them.
- Comet tails do nothing in play; they only show where the comet is heading and how fast.
- No cue or prediction for when a comet will pass near you (unlike jump pads). You see it coming.

## Anti-goals (a failure even if it works)

- A comet that kills you just for touching it, or flings you off at random as it moves.
- Comets that make the game noticeably slower, or that collide with planets or the moon.
- The belt or ring hiding players or making it hard to see the other planets.

## Comets: how they behave

The owner agreed to all of this; items marked *builder's call* were proposed by the builder.

- **What a comet is:** a small rock with a glowing tail. It is a body like the moon: it has its own weak
  gravity, so you can stand on it, run on it and jump off it. Standing on it refills the booster, and a
  rocket can blast someone off it. *Builder's call: a few metres across; one or two comets.*
- **Its path:** a long, stretched loop round the sun. It passes fast and close by the sun, then swings
  slowly out beyond the planets and comes back. Like everything else it is scripted from the match
  clock, so every machine agrees where it is. *Builder's call: faster near the sun and slower far out,
  as real comets move.*
- **Getting on:** flying through space you run into a comet, or it sweeps into you. You land on it
  instead of bouncing off, even when it is moving fast relative to you.
- **How often:** the comets' paths are tuned so that some comet passes close to some planet at least
  every couple of minutes, and a test proves it, as the pad windows are tested. Not every planet is
  promised a pass; the planets' orbits almost never line up the same way twice.
- **Getting off:** when it passes near a planet you jump off, and that planet's pull takes you. On the
  outer planets (mid, heavy, giant) the comet is slow, so a plain jump, or a jump and a little booster,
  lands you there. Near the inner planets (hot, tiny) the comet is fast, so hopping off there takes
  skilled boosting and timing. That is wanted: it keeps riding close to the sun a risk.
- **The risk:** stay on too long and it carries you close to the sun, where a jump or a blast at the
  wrong moment ends in the sun.

## Rings: how they look

- **Asteroid belt:** one loose band of tumbling rocks circling the sun between two planets' paths,
  drifting slowly round. *Builder's call: between the mid and heavy planets, where there is a clear gap.*
- **Planet ring:** a flat ring round one planet. *Builder's call: the purple giant, the biggest planet,
  tilted a little so it reads as a ring from anywhere.*

## Constraints

From the main spec and the project's `CLAUDE.md`:

- Plain ES modules, three.js 0.160.0 from the import map, no bundler, no npm packages in the page.
- Every gameplay number lives in `src/tuning.js`.
- `src/sim/` has no three.js or DOM imports, so a server can run the same code later.
- Orbits are scripted from the match clock, never simulated; fixed 1/60 s tick.
- Simple, cartoonish look; own assets only.
- The existing property tests keep passing; when one fails, change the numbers, not the property.

Specific to this work:

- No body, comets included, ever touches another body.
- Everything stays inside the void radius (400 m from the sun), and riding a comet never counts as
  being lost in space.
- Jump pads keep their launch windows (every pad at least 5 s, every planet at least once a minute).

## Left to the builder

- Comet numbers: size, gravity, path shape and tilt, period, how many.
- How the comet's path is computed, as long as it is exact from the clock and gives a matching velocity.
- Whether a pad cue may show a comet as its target.
- The look of the tail, the belt (number and size of rocks) and the ring.
- Which tests prove the above.
