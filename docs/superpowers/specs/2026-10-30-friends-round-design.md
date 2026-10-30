# Friends round: everything in the backlog but destructible planets

## Intent

The owner will play this build with friends online. This round clears the backlog, except for destructible
planets (v2), so the game feels finished and readable to newcomers. It then ships to the online server.
Nothing here may make online play less reliable: the friends test is the point.

## Order

1. The game parts:
   - the hook rework;
   - the third-person view;
   - the sun distance on the HUD;
   - better explosions;
   - the Milky Way;
   - the outer ring;
   - the deferred flare fixes.

   These are independent; the order inside this group is the builder's.
2. Last, as the owner asked: the performance and tidy-up pass, over the whole game as it then stands.
3. Merge, push, then deploy to Fly.io and switch the server off again (the owner's choice:
   `fly deploy --ha=false`, then `fly scale count 0 -a planet-arena`). If the deploy is refused or fails, hand the
   two commands to the owner.
   - The push publishes the page through GitHub Pages; the deploy updates the server. Do them back to back.
   - Until both are done, a page and server on different `PROTOCOL` versions show the "please reload" screen,
     which is the intended guard.

## 1. The hook flies (gameplay; the server decides)

- **Decided by the owner:**
  - No longer instant. The hook flies out at a fixed speed, and takes 0.5 s to reach its full range: 50 m/s with
    today's 25 m range. Closer targets are caught sooner.
  - A body that moves out of the way can be missed.
  - An animation of it grabbing onto the body.
  - A real hook, not a line.
- **The rules (my calls):**
  - Fired on a fresh hold of the right button, as now, from the eye along the view.
  - Each tick it moves `speed * dt` along its line and tests that segment against the bodies (`segmentHit`, so
    comets by their real shapes). The first body it meets (not the sun, not the ground you stand on) catches
    it. From then on the rope works exactly as today (pull, never snaps, release keeps your speed).
  - The hook flies in a straight line in the world from where it was fired. It does not follow your view or
    your motion.
  - Letting go of the button while it flies cancels it. Reaching full range without a catch is a miss. Both
    start the usual cooldown, so firing and cancelling can't be spammed.
  - The flight speed is a new constant (`HOOK.fly`, 50 m/s), separate from `HOOK.speed` (the pull's closing
    speed cap). `range` stays 25 m, and a test pins the flight to full range at 0.5 s.
  - Your own hook is predicted on your screen, as the hook is today: prediction runs `stepPlayer`, which runs
    `stepHook`. The server stays the authority, and its snapshot corrects a rare disagreement.
  - The hook's state is part of the entity, so it is already in snapshots. Other players see your hook fly,
    catch and pull. A new `PROTOCOL` (6) covers this rule change.
  - The crosshair's hook ring ("something is in reach") keeps working as now.
- **The look (my calls):**
  - A grappling hook made in Blender: a shank, three curved prongs, and a ring for the rope. It goes in
    `props.glb`, deterministic like the other models.
  - In flight: prongs folded, spinning slowly, the rope paying out from the hand behind it.
  - On the catch: the prongs snap open and dig in (about 0.2 s), with a small puff of dust in the colour of the
    surface.
  - On release: the hook is reeled back to the hand in about 0.2 s (looks only).
  - Every player's hook and rope are drawn, not only your own.
  - Sounds: today's "thwip" on firing, a new short metallic "clank" on the catch, and the reel loop as now.

## 2. Third-person view (looks only)

- **Decided by the owner:** a key toggles first and third person. The camera is over the shoulder, behind
  and a little to the right of your alien. Shots and the hook go where the crosshair points.
- **My calls:**
  - **Controls.** The key is V. The choice is remembered like the O, P, M and H toggles, defaults to first
    person, and is listed in the controls line and README.
  - **Camera.** It sits about 3.5 m back, 0.7 m right and 0.4 m up from the eye, along the view. If a body is in
    the way, it moves in along that line so it never goes inside a planet. Zooming the sniper rifle switches to
    first person while zoomed.
  - **Aim.** The game's aim does not change: shots still leave from the eye along the view. The crosshair is
    drawn where that line meets the first thing it hits (a body or a player) within 300 m, else 300 m out, so
    it always shows where the shot goes. The hook ring works as now.
  - **What is drawn.** Your own alien is drawn as others see it: posed, with the gun in hand and booster flames.
    The first-person arm and gun are hidden. Effects that come from the gun (shots, rockets, the railgun beam,
    the rope) start at the drawn figure's gun or hand.
  - **The first-person cues** (the gun shake, wider field of view and HUD flames while boosting) stay as they
    are. The flames overlay is shown only in first person.

## 3. Distance to the sun on the HUD

- **Decided by the owner:** next to the booster bar, the current player's distance to the sun.
- **My calls:**
  - It reads like "Sun 123 m": whole metres, from your middle to the sun's centre.
  - It turns the flare's orange inside the flare's reach (150 m, measured to the sun's centre, as the flare
    measures it), so it doubles as a "can a flare reach me" cue.

## 4. Better explosions (looks only)

The explosion rules are unchanged: rockets, asteroid blasts, and sun and damage deaths. Today it is a fading
sphere. My calls for the new look, in keeping with the stylised Freelancer look:
- a bright flash;
- a fireball of noisy, rolling fire that swells and darkens to smoke;
- a fast shock ring;
- sparks and bits flung out;
- a short warm light on the ground nearby.

A rocket's blast keeps its size, matching the splash radius, so a player can read what it reached. Sizes and
timings live in `LOOK`. The look must hold up when several go off at once (the minigun-free rocket spam case)
and on the lowest quality level.

## 5. The Milky Way (looks only)

- **Decided by the owner:** the Milky Way in the background.
- **My calls:**
  - A band of soft light right round the sky, painted into the sky at load like the nebulas and galaxy, with
    dense faint stars, dark dust lanes and a brighter core on one side.
  - Tilted so it crosses the planets' plane at a clear angle, and placed so it doesn't drown the existing
    nebulas and galaxy.
  - It stays subtle enough that night sides and players stay readable (the look check's night contrast must
    still pass).

## 6. The outer asteroid ring (looks only)

- **Decided by the owner:** a second ring of asteroids at about 700 m. The edge of the game stays at 600 m, so
  it is scenery: flying towards it gets you lost in the void first.
- **My calls:**
  - A wide, sparse band, about 680 to 740 m, a little thicker than the belt.
  - Bigger rocks (2 to 8 m) so it reads from the inner system, reusing the belt's rock models and drawing, and
    turning slowly.
  - No asteroids are thrown from it.
  - It may be hidden at the lowest quality level if it costs too much.

## 7. Deferred flare fixes

- A rocket kill on a lit player during a burn reads "Blown up", not "Burned by the flare": the flare only claims
  a death when its own damage took the health to 0 or below that tick.
- The alarm, voice and roar are announced once per flare (remember the flare's number), so a backwards clock
  resync can't replay them.
- The sun stays blazing until the burn ends, then dims over half a second.
- The sun light's base intensity is written once.

## 8. Performance and tidy-up (last)

- **Goal:** obvious wins and obvious cleanups, with no change in behaviour.
- **Measure first.** Profile one frame and one server tick in a busy scene: many players, rockets, a flare,
  asteroids. Fix what the measurements show, such as per-frame allocations in the render loop, repeated
  searches like `bodies.find((b) => b.kind === "sun")` in hot paths, and needless work for things off screen.
- **Tidy.** Remove duplication and dead code, and split files only where one has grown unwieldy.
- **Report.** Give before and after numbers.
- **Guard.** All tests and checks stay green; no test's property changes.

## Constraints

The project constraints in `CLAUDE.md` apply. In particular:
- every gameplay number lives in `src/tuning.js`, and looks-only numbers in `LOOK`;
- `src/sim/` has no three.js or DOM;
- own assets only (Blender models made by script);
- no em dashes;
- the page, net, look and sound checks must pass;
- the look check's frame times must stay at 60 fps on this machine at every level, and the throttled run must
  still settle. The baseline before this round is 60 fps at all three levels, and the throttled run settled at
  level 0.

## Non-goals

- Destructible planets.
- New weapons.
- Changes to the flare rules, scoring or spawn rules beyond what is listed.
- A flyable outer ring.

## Anti-goals

- Anything that makes online play laggier or less reliable for the friends test.
- A third-person crosshair that lies about where the shot goes.
- Explosions or the Milky Way that make players hard to see.
- A hook that feels sluggish to the point of not being worth using. 0.5 s at full range is the owner's number.
  If it plays badly, raise it with the owner rather than changing it silently.
