# Planet Arena: gameplay round (asteroids, moons, comets, toggles)

Date: 2026-10-28. Status: for the owner's review. The first of three rounds the owner queued after
multiplayer went live: this gameplay round, then sounds, then the look (Blender art pass, double comet tails,
nebulas). Destructible planets wait for v2.

## Intent

More happens in the sky. Rocks fall out of the asteroid belt and explode where they land, so standing still
on a planet is a risk and a passing asteroid is a weapon. There are more places to go (new moons, one of them
with jump pads), floating in space stops being a death sentence, comets stop crawling far from the sun, and
players who find the orbit lines and pad cues busy can hide them.

**Success.** On an evening of play, asteroids are something people dodge, shoot and joke about, and the new
moon pad gets used to cross the system.

## Goals

- One asteroid launched from the belt every 15 s in a random direction, visible coming, and usable as a weapon.
- Four moons in all, one with jump pads.
- No death for floating; only leaving the system kills.
- Comets with a more even speed.
- O and P hide the orbit lines and the pad cues, on your own screen.
- All of it in solo and online, the server deciding online as now.

## Non-goals

- Destructible planets (v2). Asteroids leave no crater.
- New weapons, pickup kinds or modes.
- Sounds and the art pass (their own rounds, next). New things get the current simple look.

## Anti-goals

- An asteroid that hits you with no sign it was coming.
- Asteroids so frequent that the game becomes about them instead of the other players.
- Online, an asteroid in a different place on two screens, or one that explodes on one screen and not on another.

## Asteroids

### The owner's decisions

- Rocks break away from the asteroid belt and fall in towards the planets.
- When one comes at you while you stand on a planet, it explodes like a rocket and knocks you around.
- Players can also shoot an asteroid to make it explode early (both dodging and using them against each
  other).
- One asteroid every 15 s, launched from a random point on the belt in a random direction (the owner,
  after the review: "if it hits something great, probably most will fall on the sun"). Not aimed at players
  or planets.
- A glowing trail so you see it coming.

### My calls (the owner approved them in the playback)

- An asteroid explodes on touching a planet, a moon, a comet or a player. One that reaches the sun burns up
  with no blast.
- About twice a player's height across, so it is easy to hit with a shot; the trail is what makes it easy
  to see from afar.
- The blast works like a rocket's (damage and push falling off with distance), its size a tuning number
  starting about a rocket's or a little bigger.
- Any shot that touches it sets it off: bullets, pellets, the railgun and rocket blasts.
- **Kill credit:** an asteroid set off by a shot belongs to the shooter, so its damage and kills are theirs
  (the existing last-hit rule then applies, including "until you land"). One that hits on its own belongs to
  nobody: a death from it is treated like falling into the sun, so it goes to whoever last hit you if that
  still counts under the last-hit rule, and otherwise it is a death and no kill.
- Random launches mean any planet or moon can be hit, the hot and far planets included, so none is a safe
  place to wait. Most asteroids will fall into the sun; that is expected, not a bug.
- The glowing trail is the warning (the owner's choice). No landing marker or HUD hint this round; the sounds
  round adds an incoming sound. Their approach speed and trail length are tuned so a player looking around
  sees one in time.
- They fall under the same gravity as everything else. They are started by the world's dice, seeded so the
  server and every browser make the same ones at the same times: online, the server decides, browsers draw
  them between snapshots like other projectiles.
- They come in solo too, so you can practise.

### Left to the builder

- The launch speed range (slow enough that the trail gives warning, fast enough to cross to the planets'
  paths) and what "a random direction" covers (for example, mostly in the orbital plane, where the planets
  are). The interval (15 s) is a tuning number, and so is everything else about them. Tests pin the interval,
  that the dice are the same on server and browser, and that over a long run some asteroids do hit planets.
- Lifetime limits so one that misses everything doesn't fly forever (it can leave the system and vanish, or
  expire).
- Whether the hook can catch an asteroid (my preference: no, it is a projectile).
- The rock and trail look within the current simple style; the art round may replace them.
- How asteroids go into snapshots and lag compensation for shooting them (they move fast; a shot that hits on
  the shooter's screen should hit, as for players).

## Moons

### Decided

- Giant (the ringed planet) gets two moons, one inside its ring and one outside. Mid gets one small moon.
  Heavy keeps its moon. Four moons in all.
- The giant's outer moon gets jump pads that work like every other pad: the dashed timing cue, a launch to
  another body.

### My calls

- Each new moon gets one or two pickups, like the current moon. Which ones is left to the builder, within
  the existing rules (the sniper rifle stays only on the far planet, the railgun only on the hot planet).
- New players still spawn only on the four central planets, never on a moon.
- The ring is looks only (you fly through it), so the inner moon only has to clear the giant's surface and
  the outer moon. Gravity hand-over (`hold`) must still let you stand on each moon.

### Left to the builder

- Sizes, orbit radii, periods (each must divide CYCLE), gravity numbers, and the pad layout on the outer moon.
  The existing pad properties apply to the new pads (a launch window of at least 5 s, the cue lands where it
  says). The current rule "no pads on the moon" becomes "no pads on moons except the giant's outer moon".
- The existing property "a jump from the moon ends on the moon or its planet" should hold for every moon
  without pads.

## Floating

- **Decided:** the adrift timer goes (`PLAYER.adrift` and its death). You can float as long as you like.
- Leaving the system still kills: past `VOID_RADIUS` (460 m from the sun today). Its tests stay; the adrift
  tests go.
- Kill credit is unchanged: whoever knocked you into the void gets the kill unless you landed in between.

## Comets

- **Decided:** a more even speed. Near the sun they stay about as fast as now; far out they no longer crawl.
  They go round in less time, so they pass by more often.
- This replaces the Kepler timing in `system.js` (the orbits are scripted, so any timing law is allowed). The
  property "a comet is fast near the sun and slow far out" is replaced by one for the new law (for example,
  the slowest point is at least some fraction of the fastest).
- **Left to the builder:** the timing law, and a new search for the comet paths and periods. Each period must
  divide CYCLE, and the full-cycle properties stay: no comet within 3 m of any body (the new moons included),
  some comet passes close to some planet at least every 120 s, and the slow comet still lets you hop off
  onto the heavy or giant planet.

## Toggles

- **Decided:** O shows or hides the orbit lines, P shows or hides the pad cues (the dashed path and the pad's
  light). The browser remembers each choice. The start screen's controls line lists both keys. Only your own
  screen changes.

## Hit shape (added after approval; the owner agreed)

- Found while designing the look round: shots test only one sphere of `PLAYER.radius` (0.5 m) at the feet
  end (`hitCentre`), from the feet to 1 m up, while the drawn player is 1.8 m tall. A shot at the upper body
  or head passes through, which is the multiplayer design's first anti-goal.
- **Decided:** the hit shape follows the visible body. The look round makes players aliens with a big head
  (the biggest part) on a small body, so the hit shape becomes a big head sphere and a smaller body sphere,
  sized from tuning numbers that the look round's model then matches. Bullets, pellets, the railgun, rocket
  and asteroid blasts and lag compensation all use it. Until the alien model arrives the capsule is drawn
  to fit the same two spheres, so what you see is what you hit.
- Movement and collision with the ground are unchanged.

## Online

- The rules change, so `PROTOCOL` goes up and the server is redeployed with the page. Until a page reloads it
  shows "Reload the page", as designed.
- The game is closed at the moment (the Fly.io server scaled to zero). Deploying and opening it stay the
  owner's call, as before.

## Constraints (from the project)

- Every gameplay number in `src/tuning.js`. When a property test fails, change the numbers, not the property;
  the properties this round deliberately changes are named above.
- `src/sim/` stays free of three.js and the DOM; orbits stay scripted from the match clock; fixed 1/60 s tick.
- Plain ES modules, no npm in the page; simple, cartoonish look, own assets only.
