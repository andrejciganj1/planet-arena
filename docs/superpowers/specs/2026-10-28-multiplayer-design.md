# Planet Arena: online multiplayer

Date: 2026-10-28. Status: for the owner's review. Stage 3 ("Online") of the main spec
(`2026-10-25-planet-arena-design.md`), with the changes to its rules listed at the end.

## Intent

The owner sends a link to a few friends. Everyone opens it in a desktop browser, types a name and is in
the same game within seconds, on a random planet, with a kills/deaths counter at 0/0. They play as long
as they like. When the last person leaves, the game stops; the next person to open the link starts a
fresh one.

It must feel like the solo game: your own running, jumping, boosting and hooking stay instant, and a shot
that hits on your screen hits.

**Success.** The owner and their friends (up to 5) play an evening together from the link, and nobody
says "that should have hit" or "how did I die".

## Goals

- One shared game behind one link. No rooms, no lobby, no accounts.
- Join and leave at any time. Joining puts you in at once; leaving doesn't disturb the others.
- Fair hits under lag, judged from the shooter's screen.
- Clear feedback: you can see when you hit someone, when you are hit and from where, and who killed whom.
- The solo game keeps working without the server, for testing gameplay changes.
- Costs close to nothing when nobody plays.

## Non-goals

- Strangers, public lobbies, matchmaking, rankings, saved stats. Anyone with the link can join; that is
  fine for a few friends.
- Several games at once.
- Bots. The dummy is the only computer player, and only when you are alone.
- A match end or a winner. Scores run until the game stops.
- Chat, voice, spectating.
- Anti-cheat beyond the server being the referee.

## Anti-goals (would make it a failure even if it works)

- Shots that visibly pass through a player without hurting them.
- Your own movement feeling laggy or rubber-banding.
- Being hit with no sign of it.
- Dying with no idea who did it.

## The evening, step by step

### Joining

- The page asks for a name the first time; the browser remembers it (local storage) for next time.
  Names are short plain text (my call: up to 16 characters).
- If the server is asleep, the page shows "Starting the server..." while Fly.io wakes it (a few
  seconds), never an error.
- You spawn on a random one of the central planets, tiny, mid, heavy and giant (the owner's choice), away
  from other players, with the pistol and full health. The hot and far planets stay places you travel to
  for their railgun and sniper rifle. Your counter starts at 0/0. Everyone else keeps their score.
- Each player gets their own colour from a fixed palette on joining, so players are told apart at a
  distance before their names are readable.
- Up to 8 players (my call; the owner expects at most 5). A ninth sees "The game is full".

### Seeing the others

- Above each other player: their name and a small health bar. Both shrink with distance and are hidden
  when a planet, moon or comet is in between.
- No floating damage numbers.

### Hitting someone

- **Lag compensation, the rule:** if your shot hits a player on your screen, it hits. When the server
  checks a hit it uses the target where your screen showed them at that moment. This applies to every
  weapon: bullets, pellets, the railgun, and rocket blasts (my call). A blast measures its distance to each
  player, and so its damage and the direction of its push, from where the shooter saw them; the push is
  then added to the victim's current speed. That keeps the signature move (a rocket under someone's feet,
  into the sun) working as the shooter saw it. The price, accepted: the victim
  occasionally takes a hit just after ducking behind a planet. With everyone in Europe, a few tens of
  milliseconds of lag, this is rare.
- **Hit confirmation:** the target's health bar drops and flashes white for a moment. It reacts to the
  server's confirmation, so it never shows a hit that didn't happen (one round trip late, not
  noticeable).

### Being hit

- The screen edges flash red for a moment; a bigger hit gives a stronger flash.
- A short red arc around the crosshair points towards where the shot came from (in 3D: it shows the
  direction on screen, as in other shooters).
- Your health bar drops. No damage number for yourself.

### Kills and deaths

- **Kill credit (the owner's choice):** whoever damaged you last keeps the credit until you are standing
  on something again (planet, moon or comet) or someone else hits you. A knock off a far planet that
  takes 20 s to end in the sun or the void is still their kill. My call: "standing again" means standing
  for a short time (a tuning number, about 1 s), so a hit while you stand, followed by a quick death,
  still counts. Builds on the existing `lastHitBy` / `lastHitAt` fields.
- **Dying on your own** (your own rocket, falling into the sun with nobody's recent hit): a death for
  you, a kill for nobody. No point is taken away (this replaces the main spec's "costs you a point").
- **What everyone sees:**
  - The death itself: a rocket-style explosion where the player was (in the sun, or where they were
    blown up), and the player disappears. Lost in the void: they just vanish, far away.
  - The killer: the big yellow text as against the dummy now ("Sun kill!" for the sun; my call: "Kill!"
    otherwise).
  - The victim: the existing death text plus who did it, e.g. "Into the sun! (by Ana)", then a
    respawn after the existing 3 s wait (`PLAYER.respawn`) on a random central planet.
  - Everyone: a short line in the top corner, e.g. "Ana ☀ Ben" (a sun for sun kills, a mark per
    cause otherwise), fading after a few seconds.
- **Scores:** your own kills/deaths always shown small in a corner. Holding Tab shows every player's
  name, kills and deaths, best first (my call: most kills first, fewer deaths breaks ties).

### Leaving and coming back

- Closing the tab removes your player within a second or two.
- A dropped connection (Wi-Fi blip) that comes back within about 10 s returns you as the same player,
  with the same score. After that you are a new player at 0/0. My call: your body leaves the game when
  the connection drops (so nobody farms a frozen player); coming back respawns you, without a death.
- My call: two players with the same name get a number added ("Ana 2").
- My call: if the server can't be reached at all (not just waking), the page says so after about 30 s
  and keeps retrying. If the page and the server are different versions (one deployed, the other not),
  the page says "Reload the page" instead of playing with mismatched rules.

### Alone

- When you are the only player, the dummy is there to practise on (as now). It leaves when a second
  player joins and comes back when you are alone again. Dummy kills don't count towards scores (my call:
  it is practice).

### The game ends

- When the last player leaves, the game is thrown away. The next player to join starts a new one: the
  clock at 0 (planets, comets and pads back to their start), all pickups back, every counter 0/0.
- This reset happens in the server whether or not Fly.io has stopped the machine yet.

## How it gets made

### Decided in the conversation

- **Hosting:** the game server on Fly.io, Frankfurt region, with machines that stop when idle and start
  on the first connection (per-second billing, so near zero when nobody plays). The page on GitHub Pages
  from the public repo.
- The owner creates the Fly.io account and adds the card themselves, with a personal account, never an
  EBU one. Nothing is deployed or pushed without the owner saying so.

### My calls (the owner can change them)

- **Server referee.** A Node.js (22) server runs the same `src/sim/` code at the fixed 60 Hz tick and
  decides everything: movement, hits, kills, pickups, scores. Browsers send their inputs; the server
  sends back the state. The `src/sim/` rule (no three.js, no DOM) is what makes this possible.
- **Prediction:** each browser runs your own player ahead with your inputs so moving, jumping, boosting,
  hooking and switching weapons are instant, and corrects smoothly when the server disagrees. Your own
  shots appear at once on your screen; the server decides what they hit.
- **Smoothing:** other players, their shots and pickups are drawn slightly in the past, between server
  updates, so they move smoothly.
- **One clock.** Orbits are scripted from the match clock, so the browser only needs to agree with the
  server on the clock; planet positions are never sent.
- **WebSockets** for the connection. The server may use npm packages (e.g. `ws`); the page still may
  not (the existing constraint).
- **Which mode:** the page on GitHub Pages connects to the Fly.io server. Opened from the local dev
  server it runs the solo game as today, unless told to connect to a server (e.g. a `?server=` address,
  for testing against a local server).
- **Privacy:** no accounts, nothing stored on the server beyond the running game. Names live only in the
  server's memory and the player's own browser. The server doesn't log names.
- **Tests:** the rules above as tests (kill credit, self deaths, scores, reset when empty, reconnect
  within 10 s, dummy leaving and returning, the player cap, lag-compensated hits), plus a check that the
  server and a browser compute the same result from the same inputs. A local multi-tab check (two
  Playwright pages against a local server) before anything is deployed. Feel is tested by the owner.

### Left to the builder

- The message format, update rate, how far back other players are drawn, and how corrections are
  smoothed.
- How lag compensation keeps the history it needs for projectiles that fly for several seconds.
- The respawn rule for "away from other players" on a random planet (the existing `spawnPoint` handles
  distance on one body).
- The red-flash and arc looks, the colour palette, the kill-feed marks.
- The Fly.io setup files (Dockerfile, fly.toml) and how the page learns the server's address.

## Changes to the main spec

The main spec (`2026-10-25-planet-arena-design.md`) says a match ends at 20 kills, a self-inflicted sun
death costs a point, bots keep a match at four players, and there are rooms by link. For now: no match
end, self deaths cost nothing, no bots (only the dummy when alone), one shared game. The main spec gets a
note pointing here.
