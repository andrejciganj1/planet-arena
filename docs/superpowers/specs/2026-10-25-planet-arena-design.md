# Planet Arena: design

Date: 2026-10-25. Status: for the owner's review.

## Intent

A fast 3D arena shooter in the browser, in the spirit of Quake 3 Arena deathmatch, fought across a small
solar system. Every planet and moon has its own gravity, which pulls on players, bots and
projectiles. The physics is the point: the best kills come from using gravity and knockback, not only
from aiming.

The signature moment: you fire a rocket under an opponent standing on the smallest, lightest planet.
The blast throws them off the planet, they fall towards the sun, and the sun kills them on touch.

**Who it is for.** The owner and a small group of friends, playing online together from a link.
Bots fill in when nobody else is around.

**Why.** The owner is just getting into making games. They won't write the code themselves: the builder
writes all of it, in whatever way builds it best. The owner plays each build and gives feedback.

**Where.** All the players are in the same country, so one server in a nearby European
region serves everyone with low lag.

**Success.** The three of them can open a link in their browsers and play a full match together.

## Goals

- Online deathmatch for a small group from a browser link, with no install.
- Bots, so the game can be played alone or with fewer people.
- A moving solar system where gravity shapes every jump and every shot.
- Every gameplay number (gravity strengths, speeds, damage, timers, orbit speeds, booster) in one tuning
  file, so tuning after a playtest is quick.

## Non-goals

- Playing with strangers: no public lobby, no matchmaking, no accounts, no rankings.
- Phones and tablets. Desktop browsers with keyboard and mouse only.
- Making money, stores, unlocks.
- Several maps. One solar system to start.
- Detailed graphics.

## Anti-goals (failure even if it technically works)

- Movement that feels floaty, sluggish or disorienting. If running around a planet and jumping between
  planets isn't fun alone, the rest doesn't matter.
- Realism that hurts play: orbits too fast to plan a jump, gravity so strong you can never leave a
  planet, or so weak you can never stay.
- Online play where players disagree about what happened (you saw your rocket hit, they say it didn't)
  often enough to be frustrating.
- A game that runs badly on an ordinary laptop.
- Anything that needs an install or a plugin.

## The game

### The solar system

- **The sun** sits in the middle. It has the strongest gravity in the system. Touching it kills
  instantly.
- **Planets** (four to six) orbit the sun slowly, at clearly different sizes and gravity strengths: from
  a big heavy one where you feel nearly grounded to a tiny light one where a rocket blast can throw you
  into space. One lap takes a few minutes, slow enough to watch the next planet come round and time a
  jump, so over a match the planets line up in different ways and routes and sniper lines open and
  close.
- **Moons** orbit some planets. They have weak gravity and stay close to their planet, so a jump from a
  moon always reaches its planet. They are high perches and a second place where knockback can throw
  someone off.
- Planets don't spin, to keep it simple at first.
- Standing on a planet you see the others moving across the sky and the sun at the centre. You ride along
  with your planet without noticing its motion.

### Gravity and movement

- Every body (sun, planets, moons) pulls on players, bots, rockets and sniper bullets.
  Gameplay feel decides how the pulls are shaped, not real physics: on or near a body's surface its own
  pull dominates; between bodies the pulls combine, with the sun's pull drawing anything that has lost
  its footing.
- "Down" for a player is towards the body they are standing on or falling to; the view and controls
  turn smoothly as "down" changes during a flight.
- **Jump pads** (trampolines) on the planets point outwards in fixed directions. Whether a launch
  reaches another planet depends on where that planet is at that moment.
- **Booster.** In the air, a small booster pushes the player in the direction they choose, so they are
  never helpless after a jump pad launch or a blast. It drains quickly. It is for correcting a course
  or reaching a nearby moon, not for flying freely: how you jumped still counts most.
  - My calls: it refills while you stand on a body (planet or moon), and a bar shows how much
    is left.
  - A mistimed launch or a big blast is therefore usually survivable with good boosting. The sun stays a
    real danger for anyone who has used their booster up or is thrown hard on a light planet or moon.
    Jump pads still show when a launch will reach the next planet, so timing is a skill, not luck.
- Fast Quake-like movement on the ground: running, jumping, rocket jumps.

### Weapons

| Weapon | How it uses gravity | Role |
|---|---|---|
| Pistol | Bullets fall with gravity (as any projectile) | Weakest. Everyone starts and respawns with it. Drawn as two cuboids. |
| Rocket launcher | Slow rockets that curve with gravity | The blast knocks players away; on a light planet or moon it can throw them into the sun. Rocket jumps. |
| Sniper | A fast bullet that bends a little over long shots | Zooms. Picks people off across planets; aim slightly ahead and above. |
| Railgun | None: instant and dead straight | As in Quake. |

Weapons other than the pistol are picked up on the planets, so players keep flying between them and
fighting over them.

### Rules

- Deathmatch, everyone against everyone. The first to 20 kills wins.
- A death in the sun counts as a kill for whoever hit you last, if they hit you within the last few
  seconds. Falling into the sun on your own costs you a point.
- You respawn on a random planet, away from other players, with only the pistol.
- Health only, no armour, to start. Health pickups are on the planets too.
- Pickups come back a while after someone takes them.
- Bots join automatically to keep a match at about four players, and leave as people join.

### Look

Simple and cartoonish: flat colours, simple shapes, a glowing sun, a starfield. The physics and the
moving solar system are the show; simple shapes also keep it fast in a browser.

### Controls

Mouse to look (the pointer is captured while playing), WASD to move, space to jump, left mouse to fire,
right mouse to zoom the sniper, number keys and mouse wheel to change weapons.

## How it gets made

### Decided in the conversation

- Runs in a desktop browser from a link, no install.
- Online play with friends, plus bots.
- Simple, cartoonish graphics.
- Order: a single-player prototype first, to get the movement and gravity feeling right, before any
  networking. If it isn't fun alone it won't be fun online.

### My calls (the owner handed these over; they can change them)

- **three.js** to draw the game (the owner's other project uses it).
- **Rapier** (its browser build, which also runs in Node.js) for collisions, unless the builder finds the
  shapes simple enough (spheres for planets and moons) to collide without it.
- **Our own code** for gravity and the player's movement, as standard character controllers assume "down"
  always points the same way.
- **Orbits are scripted, not simulated**: each planet and moon follows a fixed path computed from the
  match clock. Server and players then agree on where every planet is without sending it, and the map
  can't drift into a shape nobody designed.
- **Online play, later:** one small server (Node.js), in a European region close to the players, runs each
  match's simulation and is the referee.
  Players send their inputs; the server sends back the state. Each player's own movement is predicted
  on their screen so it feels instant, and other players are shown smoothly. With everyone in one country
  the lag is small (tens of milliseconds), so this stays simple; the railgun's instant hit is still
  checked against where the target was on the shooter's screen (lag compensation), as that is where lag
  shows most. A room is created
  with a link the host sends to the others.
- **Hosting:** a small paid server or hosting service, a few euros a month at this scale, which also
  serves the page. The builder picks the service when online play is built; the owner decides before
  any money is spent.
- **Language:** JavaScript (plain ES modules) in the page and on the server, so the simulation code is
  shared.
- **Tests** for the parts that can be tested without playing: gravity, orbits, knockback, scoring rules,
  and that the server and a player's screen compute the same result from the same inputs. Feel is tested
  by the owner playing each build.
- **No deadline.** The work follows the order below; the owner says if they want to play together by a
  date, and the plan is cut down to reach online play sooner.
- **How the code is written** (structure, libraries, tests) is the builder's choice, as the owner won't
  be editing it.
- **Own setting and assets.** Quake 3 Arena is an inspiration only: no names, art or sounds from it.

## Order of work

1. **Prototype (single player, no server).** One sun, five planets, one moon, jump pads,
   the booster, the pistol and the rocket launcher, and a dummy target that can be blasted into the sun. Done when the
   owner finds running, jumping and flying between planets fun. (Changed after the first playtest: it began
   with three planets and a station; the owner swapped the station for two more planets and dropped
   stations from the game. Pickups go on the planets.)
2. **The full game alone.** Four to six planets, moons, all four weapons, pickups, health, the
   rules and score, bots.
3. **Online.** The server, rooms by link, prediction and smoothing, lag compensation, hosting. Done when
   the owner and their friends play a full match.
   (Designed in `2026-10-28-multiplayer-design.md`, which changes some rules for now: one shared game
   instead of rooms, no match end, no bots, and dying on your own costs nothing.)
4. **Polish.** Sounds, effects, tuning from their playtests.

## Left to the builder

- Exact numbers: sizes, gravity strengths, orbit periods, speeds, damage, timers (all in the tuning
  file, tuned with the owner).
- How gravity pulls are shaped and blended between bodies, within the rules above.
- Layout of the solar system: which planets have moons, where pickups and jump pads go.
- How bots plan jumps between moving planets, use the booster and aim with gravity.
- Sound and effects style, within "simple and cartoonish".
