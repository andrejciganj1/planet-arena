# Planet Arena: the look

Date: 2026-10-28. Status: for the owner's review. The third of three rounds (gameplay, sounds, look). It
assumes the gameplay round is in (asteroids, four moons, the moon pads, the head and body hit shape).

## Intent

The game works and plays; now it should look like a place. The owner's reference is Freelancer (and the X
series): deep colours, glowing nebulas, strong day and night, planets with character. **The owner's
direction: "more like Freelancer, keep it stylised but richer".** Not photoreal; the project's "simple,
cartoonish look" rule becomes "stylised and rich, Freelancer-like".

**Success.** Someone opening the link for the first time stops for a second to look around before they
start shooting, and players call planets by what they are ("meet me on the ice planet").

## Goals

- Planets first (the owner's priority): each one a recognisable world, from afar and when standing on it.
- Players as aliens.
- A sky, a sun, comets, asteroids, weapons, pickups and pads that match.
- Still smooth on an ordinary laptop, still loads in a few seconds.

## Non-goals

- Uneven ground: planets stay perfect spheres underfoot (terrain is v2, with destructible planets).
- Any change to rules or numbers that affect play. This round is looks only, and needs no server update.
- Music, sounds (their own round).
- Bought or downloaded art. Everything is made here, in Blender or in code.

## Anti-goals

- Pretty but unreadable: players, shots, asteroids or pad cues lost against a busy background.
- A slow page: long loading or a frame rate drop that makes aiming worse.
- A model that doesn't match what can be hit (the hit shape is the gameplay round's head and body spheres).

## Planets (the owner approved each)

- **Hot** (red): lava world, glowing cracks on the night side.
- **Tiny** (green): small jungle world.
- **Mid** (blue): ocean world. Up close, the owner's words: "full of shallow water, maybe one small island".
- **Heavy** (orange): desert or canyon world.
- **Giant** (purple, ringed): gas giant with bands and storms, and its ring.
- **Far** (teal): ice world.
- **Moons:** grey and cratered, each a little different.
- **Sun:** a glowing, churning surface with a corona.

My calls, approved in the playback:

- Every surface detail is painted on the sphere or lies almost flat on it: the island is a low sandbar,
  canyons and craters are painted.
- Each surface has a close-up detail layer (ripples in the shallows, cracks in the lava, frost, sand) so it
  holds up when you stand on it, not only from afar.
- Night sides are dark, with a glow where it fits (lava cracks, a faint aurora on the ice world).
- Water, lava and ice are looks only: no slowing, no damage, no sliding.

## Players (the owner's design)

- Aliens with a big head, the biggest part of the body, on a small body. Big black eyes. A space suit.
- Each player's skin is their player colour (from `COLOURS`), so players are told apart by skin.

My calls, approved in the playback:

- The suit is white or light grey for everyone, so the skin colour stands out.
- A clear bubble helmet round the head.
- The gun is held in front and visible from both first and third person. Name and health bar stay above
  the head.
- The dummy is an alien too, dull grey.
- The head and body match the gameplay round's two hit spheres.

## The rest (my calls, approved in the playback)

- **Sky:** a few large nebulas and a distant galaxy in Freelancer-like colours behind the stars, as a
  background image. Dim enough that players and asteroids stand out.
- **Sun:** the surface above, a soft corona, and a glow that spills over the screen when you look at it.
- **Comets:** two tails, both away from the sun: a curved pale-yellow dust tail and a straight thin blue ion
  tail.
- **Light:** stronger shadows; planets shadow their moons and rings; the sun is the one strong light.
- **Weapons:** six proper models, each its own shape with a colour accent, and muzzle flashes.
- **Asteroids and the belt:** rough dark rocks. Flying asteroids glow orange-hot with their trail.
- **Pickups:** float and spin with a soft glow; a weapon pickup shows its weapon.
- **Pads:** metal launch plates, with lights that show the cue.
- **Performance:** if an effect costs too much on an ordinary laptop, it is simplified.

## How it gets made (my calls)

- Models (aliens, weapons, pickups, pads, rocks) made in Blender from Python scripts run headless
  (`/opt/homebrew/bin/blender` is installed), exported as `.glb` files into the repo. The scripts are kept in
  the repo too, so a model can be changed and rebuilt.
- Planet, sun and sky images made by code (scripts in the repo, Blender or Node), saved as image files.
  Kept small: a size budget for everything the page downloads (the builder sets it; a few megabytes in all).
- Loaded with three.js's own loaders from the existing import map (`three/addons/`), so still no npm in the
  page and no bundler. Close-up surface detail and effects like the sun glow may be shaders in
  `src/client/`.
- While models load, the game shows the current simple shapes, so the page never waits on art to start.
- All of this is in `src/client/` and asset folders; `src/sim/` and the server are untouched. Looks-only
  numbers live in `src/tuning.js` like `FEEDBACK`.

## After the review (my calls)

- **Reference machine:** a steady 60 fps at 1080p on an Apple M1 MacBook Air or a recent laptop with
  integrated graphics. An automatic quality step (fewer effects, lower resolution) kicks in if the frame
  rate drops, rather than a settings menu.
- **Shadows:** every body is a sphere, so planet-on-moon and planet-on-ring shadows are computed exactly in
  the shaders (a sphere test against the sun direction), not with shadow maps. Players and objects get a
  soft blob shadow under them.
- **Sun glow:** a screen-facing sprite that brightens when the sun is in view, not a full-screen
  post-processing pass, unless the frame budget allows it.
- **Head hit sphere = the helmet.** The gameplay round sizes the head sphere to the bubble helmet's outer
  shape, so a shot that touches the glass hits.

## The owner's answers after the review

- **Night sides: in the middle.** Darker than day and a place where you are harder to spot, but never
  invisible: suits have a faint glowing trim in the player's colour, pickups and pads keep their soft glow,
  and name tags still show. The screenshot checks show a player on a night side is visible from 30 m.
- **Alien movement: made in code**, no rig. Legs swing when walking, the body leans when jumping, falling or
  boosting, the head and gun follow the aim, the hook arm reaches out. The head stays on its hit sphere in
  every pose.
- **Reviews: the owner looks once, at the end** (they changed their first answer, a look after the planets).
  The planet scripts are built so colours and detail are quick to adjust after that look.

## Left to the builder

- Texture sizes, shader tricks, how shadows are done within the performance goal.
- The exact model proportions within the brief, matching the hit spheres.
- How the background image is made and mapped.
- How it is checked: screenshots with the existing `?view=` camera for each planet up close and from afar,
  the page check for errors and frame time, and a page weight check. The owner judges the look at the end.
