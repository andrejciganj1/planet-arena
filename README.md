# Planet Arena: prototype

A prototype, playable alone or online with friends, of a physics arena shooter across a small solar system: one sun, five planets,
four moons and a few comets. Every body has its own gravity. Blast the dummy off the tiny green planet and watch it fall
into the sun.

From the sun outwards: the hot red planet (close to the sun, so watch your footing), the tiny green
planet, the mid blue planet where you start (with a small moon), the asteroid belt, the big heavy orange planet
with its moon, the light purple giant with its ring and two moons (one circles through the ring, the outer
one has the only moon pads, two), and the small teal far planet, where the sniper rifle is.

Four comets loop round the sun on tilted, stretched paths, quickest near the sun but never crawling far
out. Fly into one (or let it sweep into you) and you land on it; ride it, and jump off when it passes near a
planet. The two fast comets (80 s laps) pass the hot and tiny planets often, but hopping off near the sun
takes good boosting. The slow one shares the heavy planet's 5-minute lap and passes it every time round,
where a plain jump gets you off. The fourth swings out to about 375 m, past the far planet's path, also on
a 5-minute lap. Stay on too long and any of them carries you close to the sun.

The giant's ring and the belt's rocks are scenery: you fly straight through them. Now and then (every 15 s)
a rock leaves the belt, glowing and trailing, aimed roughly sunward. Most burn up in the sun; some hit a
planet or moon. A flying rock explodes like a rocket on a planet, moon, comet or player, and any shot
sets one off, with the blast counted as the shooter's. Online, the server decides where they go.

Shots hit two spheres on a player, the head (the bubble helmet) and the body, so aim at the middle.
Floating in space no longer kills; only leaving the system (600 m from the sun) does.

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
`NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/net_check.cjs "http://localhost:8100/?server=ws://localhost:8787&debug" shots` prints `OK`.

## Deploy

Nothing here is automatic; each step is the owner's.

1. Create a personal Fly.io account, add a card, install `flyctl` and log in.
2. `fly launch --no-deploy` (keep the existing `fly.toml`; the app name must be free, and if it differs,
   change `SERVER` in `src/client/config.js`), then `fly deploy --ha=false`. Without `--ha=false` the first deploy makes two machines, and the match lives in one
   machine's memory, so friends would land in separate games; if two exist, run `fly scale count 1`. The machine stops when idle and starts on
   the first connection, so the first join after a quiet spell takes a few seconds.
3. Push `main` to GitHub and turn on Pages (branch `main`, root). `.nojekyll` keeps Pages from rebuilding the files.

Whenever rules, tuning or messages change, bump `PROTOCOL` in `src/net/protocol.js` (now 3) before deploying, so a page
still cached from the old version says "reload the page" instead of playing by different rules. A rules change
is a server change too: deploy it with `fly deploy --ha=false`.

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
| O | Show or hide the orbit lines (the browser remembers) |
| P | Show or hide the pad cues; hidden, pads look neutral (the browser remembers) |
| M | Sound on or off (the browser remembers) |
| H | The hit sound (the ding when you hit someone) on or off (the browser remembers) |

- Bottom left: your health (your own rockets hurt you too), the weapons you hold, the one in hand with its
  ammo, and the booster's fuel, which refills while you stand on anything. A full booster burn adds 18 m/s,
  more than it takes to leave most planets, so boost with care. Extra fuel from a pickup shows in blue.
- The crosshair gets a ring when the hook can catch something.
- You start with the pistol, which never runs out. Pickups float over fixed spots on every planet and
  the moons: health (a white case with a red cross), booster fuel (an orange can, fills the tank to double),
  weapons (the gun itself) and ammo (a dark crate striped in the weapon's colour). A taken pickup comes back
  after a while; its spot shows a faint ghost meanwhile. The sniper rifle is on the far planet and the railgun on the hot planet. Dying
  costs you everything but the pistol.
- Jump pads are the metal plates with an arrow. Green lights mean a launch right now lands on another body;
  red means it won't. Stand near one to see the predicted path.
- The dummy (a dull grey alien) lives on the tiny green planet and comes back 3 s after it dies.

## The look

Stylised and rich, after Freelancer: glowing nebulas, a churning sun, planets you can tell apart (lava, jungle,
ocean, desert, gas giant, ice, cratered moons), aliens in bubble helmets, proper guns. Everything is made here,
by scripts in the repo or by shaders; nothing is downloaded or bought.

- **Painted at load, no image files.** The sky (nebulas, a galaxy, faint stars) and every planet and moon are
  painted by shaders into cube maps when the page opens (the planets one a frame, after the first frame, so
  the game starts at once). The sun's surface, its corona and the glow when you look at it are shaders that
  run every frame. Shapes and colours are in `src/client/look/` (`sky.js`, `sun.js`, `planets.js`), the
  numbers in `LOOK` in `src/tuning.js`.
- **Models from Blender scripts.** The alien, the six weapons and the props (pickups, pads, rocks) are built
  by Python scripts run headless in Blender, from code and fixed seeds, so a rebuild gives the same file:

  ```
  blender -b -P tools/blender/alien.py -- --body 0.4 0.4 --head 1.25 0.55 --out assets/models/alien.glb
  blender -b -P tools/blender/weapons.py -- --out assets/models/weapons.glb
  blender -b -P tools/blender/props.py -- --out assets/models/props.glb
  ```

  The alien's `--body` and `--head` are `PLAYER.hit`'s spheres (the helmet is the head hit sphere), and the
  weapons' accents are `LOOK.weapons.colors`; `tests/look.test.mjs` checks both against the files. Until a
  model loads (or if it fails) the game draws simple shapes.
- **Quality.** The page drops a level when frames average under 50 fps for 2 s, and climbs back only after a
  steady stretch (longer each time a level fails, so a borderline machine settles instead of flipping). On a
  high-density screen the lower levels draw fewer pixels (a 2x screen: 2, 1.5, then 1 per CSS pixel; never
  under 1, so a normal screen stays sharp). Level 1 also draws one layer of the planets' close-up detail
  instead of all and fewer octaves of the sun's churn; level 0 turns the close-up detail and the sun's screen
  glow off and draws fewer octaves and corona streamers still.
- **Look check** (Playwright through `npx`, static server running):
  `NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/look_check.cjs "http://localhost:8100/" shots/look`
  takes a screenshot of every view (each planet from afar and by day and night, the sun, the sky, the alien,
  each weapon, the props) with the clock standing still, checks a player on a night side stands out, times
  each quality level at 1080p, checks a slowed CPU drops a level and stays there, and sums the asset bytes.
  A pattern after the folder takes only the matching views, e.g. `'pickup|belt'`.

## Sounds

There are 24 sounds. All but two are made in the browser with Web Audio (recipes in `src/client/synth.js`,
no sound files), so there is little to download and the page stays small. `src/client/sounds.js` decides what
plays from the game's events and changes, and `src/client/audio.js` plays it: other players are heard from
where they are (panned in 3D from your camera, quieter with distance), a limit on voices keeps bursts from
becoming a roar, and a cap on loops keeps a swarm of rockets quiet. Click the page once before anything
sounds (browsers insist). If Web Audio fails, sound turns off and the game carries on.

To hear every sound on its own, open http://localhost:8100/sounds.html (linked from nowhere in the game).
To check them without listening (Playwright through `npx`, static server running):
`NODE_PATH=$(dirname $(find ~/.npm/_npx -maxdepth 3 -path '*node_modules/playwright' | head -1)) node tools/sound_check.cjs "http://localhost:8100/sounds.html"`
prints each sound's level and length and `OK` when all are audible, unclipped and short (loops steady).

The two sounds from files are the announcer's "Sun kill!" (`assets/sun-kill.wav`) and the scream of an alien
lost in space, "Noooo!" (`assets/scream.wav`): both spoken by the Norman voice by Bryce Beattie (public domain,
trained on LibriVox recordings, https://brycebeattie.com/files/tts/) with
[Piper](https://github.com/OHF-Voice/piper1-gpl) 1.8.0, used only to make the files, then trimmed. The game
plays the announcer deeper with its own echo, and the scream higher, its "o" held on a loop, then sagging
away like a small creature's.

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

- Planets and moons keep their full pull up to 1.75 times their radius (`reach`), so a rocket blast
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
