# Planet Arena: sounds

Date: 2026-10-28. Status: for the owner's review. The second of three rounds (gameplay, sounds, look). It
assumes the gameplay round (`2026-10-28-gameplay-round-design.md`) is in: asteroids, the new moons and pads.

## Intent

The game is silent today. Sound should tell you what is happening without looking, the way Quake 3 Arena
does (the owner's reference): short, punchy effects, a confirmation when your shot lands, an announcer for
the big moment, and other players you can hear coming.

**Success.** Players react to sounds: they turn towards a shot behind them, hear an asteroid coming, and
laugh at the announcer after a sun kill.

## Goals

- Every weapon, movement and world event the owner listed has a sound.
- Other players' sounds come from where they are.
- A hit sound confirms your hits; an announcer calls sun kills.
- Mute and the hit sound can be switched off, remembered by the browser.

## Non-goals

- Music (the owner: "only sound effects for now").
- Voice chat.
- More announcer lines than "Sun kill!" this round.
- Recorded or downloaded sounds, except the one announcer file made as described below.

## Anti-goals

- Copying Quake 3's or any other game's sounds. Ours are in that spirit, made by us.
- Sounds that tire: a minigun or footsteps that grate after ten minutes.
- Sounds that lie: a hit sound for a hit the server didn't confirm, or a sound from the wrong direction.

## The sounds

### The owner's decisions

- **Weapons:** in the spirit of Quake 3, short and punchy.
- **Hit sound:** a "ding" when your shot hits someone ("let's try"), with a way to turn it off.
- **Announcer:** a sun kill gets an announcer call, like "double kill" in arena shooters.
- **Jump pads:** a "boink".
- **Pickups, explosions, footsteps.**
- **Hook:** like a zipper, or a rising sound like a bottle getting filled.
- **Other players:** heard from where they are.
- **Made by Claude**, all of them. Only sound effects, no music.

### My calls (the owner approved them in the playback)

- Each of the six weapons has its own firing sound; the rocket also hisses in flight.
- Asteroids have an incoming sound (promised by the gameplay round as the warning beside the trail) and
  explode like rockets.
- Also: a grunt when you take damage, a death sound, the booster's hiss while held, a click on switching
  weapons and on an empty weapon, a soft sound when a pickup comes back.
- Announcer: "Sun kill!" only, to start. It plays for the killer. My call beyond the playback: everyone also
  hears it, quieter, so a sun kill is an event for the whole game.
- Keys: M mutes all sound, H turns the hit sound on and off; the browser remembers both; the start screen's
  controls line lists them.
- Your own sounds a little louder than others', so your shots are always clear.
- Sound starts with the "Click to play" click (browsers allow sound only after one).

## How it gets made (my calls)

- **Effects:** made in the browser at runtime with the Web Audio API (oscillators, noise, filters and
  envelopes), no sound files and no npm packages. This fits the project's "own assets, no npm in the page"
  rule and the cartoonish style, and keeps the page small.
- **Positional sound:** Web Audio panning in 3D from the listener at the camera. Quieter with distance, cut
  off beyond a distance (a tuning number) so the far side of the system is silent.
- **Announcer:** one short audio file in the repo, made once with a speech generator whose licence allows
  publishing the result in a public MIT project, then processed (deeper, with an arena echo). The owner
  agreed: install an open-source speech tool (for example Piper) on this Mac only to make the file, use a
  voice whose licence allows publishing, with a credit in the README if the licence asks for one. The builder
  checks both licences before using them. The owner does not need to hear the line before it goes in. If no
  suitable voice is found, the fallback is a synthesised robot voice made in the browser, and the owner is
  told.
- Sound code lives in `src/client/`. `src/sim/` stays silent: sounds react to the events and state the
  simulation already produces (shots, hits, deaths, pickups, pad launches, explosions, the hook), adding new
  events to the sim only where one is missing.
- Online, sounds play from what the browser sees: your own actions at once (as your movement and shots
  already are), other players' from snapshots, and the hit sound only from the server's confirmation (the
  same rule as the health bar flash).
- Volumes and distances are looks-only tuning numbers in `src/tuning.js`, like `FEEDBACK`.

## Order and listening (my calls)

- This round is planned and built after the gameplay round is merged, so the asteroid sounds hook into the
  events that round really produces.
- The builder cannot hear. So the plan builds early a way to play every sound on demand (a sound test page
  or a `?debug` key). The owner listens once, when everything is implemented ("I will hear it once
  everything is implemented"), and their feedback becomes sound changes before the round is merged.

## Left to the builder

- The sound design of each effect, within the brief above.
- How footsteps are timed from movement, and how other players' footsteps are derived from snapshots.
- How many sounds may play at once, and how repeated sounds (minigun, shotgun pellets) are kept from piling
  up.
- How the tests cover this. The sound code itself is hard to test; pure helpers (which events make which
  sound, volume by distance, the mute and hit settings) can be tested like the HUD helpers.
