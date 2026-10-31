# Solar flares

## Intent

Every minute or two the sun warns, then flares. Anyone caught in its light near the sun burns. The point is the
scramble: a warning goes up, and players race for the dark side of their planet or the shadow of a moon. The
inner planets (Hot and Tiny, with the railgun and other good pickups) become a gamble, and knowing where the
shadow falls pays.

Success: a flare is unmistakable (seen, read and heard), a player who reacts in time always has a way out, and
a careless one near the sun dies.

## Changed after the playtest preview (owner, 2026-10-31)

- The warning is 5 s, with the banner "SOLAR FLARE INCOMING" and the alarm; no voice (a woman's voice was
  tried and dropped by the owner).

## Changed with the plan (owner approved)

- The warning voice is a file in the same public-domain Norman voice as "Sun kill!" (made with Piper), played
  like the announcer, not the browser's speech.
- The flare's damage shows no hit flash and plays no "hurt" sound (it ticks 60 times a second); the orange
  tint and the sizzle are its feedback, and it never counts as anyone's hit.
- Flares come 60 to 120 s apart from one warning to the next, the first no earlier than 60 s.
- The shadow line starts at the movement sphere's centre, as the sun death uses.

## Decided by the owner

- A warning first: written on screen and spoken, "Imminent solar flare detected".
- A steady burn, not an instant kill: about 25 health a second at the inner planets (dead in about 4 s).
- Only players in sunlight burn. Shadow is shelter.
- Reach: Hot and Tiny burn fully; Mid burns too, but less (about 10 a second on its sunny side); Heavy and
  further out are safe.
- Only players burn. Pickups, asteroids, rockets and bodies are untouched.
- The look (built and approved on branch `solar-flare` as a spike, `src/client/look/solarflare.js`):
  - glowing arches rise over one patch of the sun during the warning, flickering and heating up;
  - a second, smaller set rises 135 degrees round the sun from the first, so everyone sees one;
  - at the burst the patches go white-hot, the sun swells and blazes, a faint shell of light runs out, a
    plasma cloud lifts off both patches, and sunlit sides of the planets bleach while night sides stay dark;
  - the arches sag and fade afterwards.

## Rules

### Schedule

- Calls set by me (Claude), adjustable later: flares about every 90 s, give or take 30 s, measured from the
  start of one flare to the warning of the next, and none in the first 60 s of a match.
- The schedule is a pure function of the match clock in `src/sim/` (seeded, like `hashRand`), so the server
  and every client agree without sending anything. Each flare also gets its patch direction from the same seed.
- "First 60 s" is on the match clock (`world.t`). On a long-running server that protects only the first minute
  after it starts, not each player's join (my call; joining players get the warning like everyone else).
- Phases: a warning of 10 s, then the flare, which burns for 6 s, then the look fades (about 3 s, no damage).

### Who burns

- Players and the practice dummy (it stands in for a player). My call: alive only; a dead player waiting to
  respawn is not touched.
- Sunlight test, once a tick: a straight line from the player's body hit sphere centre (`PLAYER.hit.body`) to
  the sun's centre. If any planet, moon or comet blocks it (their real shapes; comets are lumpy, use the
  existing `segmentHit`), the player is in shadow. Asteroids and other players cast no shadow. There is no
  partial shade: in light or not.
- The whole inner system burns, whichever way the patches face. My call: the patches are for show; tying the
  danger to one side would make the warning harder to read.

### Damage

- Distance d is from the sun's centre to the player's body sphere centre.
- The reach is a distance rule, not a list of planets: anyone in light within it burns, including a player
  flying or riding a comet.
- Rate: 25 health/s for d at most 80 m, falling linearly to 0 at 150 m, nothing beyond. That gives about 25 on
  Hot (46 m) and Tiny (78 m), about 10 on Mid's sunny side (about 108 m), and 0 to 13 on Mid's moon as it
  swings. All four numbers live in `src/tuning.js`.
- Damage applies every tick of the 6 s burn at the full rate (no ramp), in the same way as other damage, so
  health, hit flash and death all behave as usual.
- A flare death has its own cause, `"flare"` ("Burned by the flare"). Credit follows the existing rule
  (`creditOf`): whoever hit you last still gets the kill if the hit counts, as with falling into the sun.

### Respawns during a flare

My call: a player who respawns during a warning or a burn is placed where the flare cannot reach them (in
shadow, or beyond 150 m), if the usual spawn rules allow such a spot; otherwise as usual. Dying again straight
after respawning, with no way to react, would feel unfair.

## What players see and hear

- **Warning:** a banner reading "IMMINENT SOLAR FLARE DETECTED" with a countdown, an alarm, and the
  same words spoken.
  - The voice uses the browser's own speech (`speechSynthesis`, English, lowered pitch, a little slow), so no
    recording of anyone ships.
  - It sounds different on each computer.
  - It respects the M key.
  - Where speech is unavailable, the alarm plays alone.
- **Burst:** a deep roar. The banner changes to tell players to get out of the light (wording left to the
  builder; no em dashes).
- **While you burn:**
  - an orange tint pulses on the screen;
  - a sizzle loops;
  - health falls with the usual hit flash.
  - When you are in shadow during a flare, none of these play, so a player can tell at once that they are safe.
- **The look** is the approved spike, driven by the real schedule instead of its 30 s stand-in timeline:
  - The look's brightness follows the 6 s burn, so it stays blazing while the damage lasts.
  - `LOOK.flare.spike` goes away.
  - A debug way to view a flare at a fixed moment must stay, through `?debug&at=T` on a known flare time, or
    the `?flare=` parameter.
- New sounds are synthesised in code like the others and appear in `sounds.html` and the sound check.

## Online

- The server's sim deals the damage, like all other damage.
- Clients work out the warning and the look from the match clock themselves.
- The rules change, so `PROTOCOL` goes to 5.
- The Fly server is not redeployed as part of this work. That is the owner's call, and a redeploy is already
  pending from the last round.

## Constraints

The project's constraints in `CLAUDE.md` apply. Most relevant:
- every gameplay number lives in `src/tuning.js`, and looks-only numbers in `LOOK`;
- `src/sim/` stays free of three.js and the DOM;
- when a property test fails, change the numbers, never the test's property;
- own assets only;
- no em dashes.

## Non-goals

- No shields, armour or other protection beyond shadow.
- No partial shade or penumbra damage.
- No flare effects on pickups, asteroids, projectiles, the hook or orbits.
- No change to how often or where asteroids fly.

## Anti-goals (a failure even if it works)

- A death the player had no chance to avoid. The warning must be long enough to reach shadow from anywhere on
  Hot or Tiny on foot or by booster.
- Burning while in shadow, or no burn in plain light. The shadow test and the look must agree on what is lit.
- A flare that can be missed: no warning heard or seen because the sun was behind you or sound was off.

## Tests the builder should include

- The schedule:
  - is the same for the same clock;
  - starts no flare before 60 s;
  - spaces flares within 60 to 120 s;
  - has phases of the stated lengths.
- No damage outside the 6 s burn.
- The damage rate at 46, 78, 108 and 150+ m matches the falloff.
- A player on the sunny side of Hot dies within about 4 to 5 s.
- The same player on Hot's night side, or behind a moon or comet, takes nothing.
- Death cause is `"flare"`, and credit follows `creditOf`.
- The dummy burns.
- Respawns during a flare land out of its reach when possible.
- `PROTOCOL` is 5.

## Left to the builder

- Module layout in `src/sim/` and `src/client/`.
- The sound designs, and the banner's look and wording during the burn.
- How quality levels thin the look on slow machines.
- Look check views of a flare.
