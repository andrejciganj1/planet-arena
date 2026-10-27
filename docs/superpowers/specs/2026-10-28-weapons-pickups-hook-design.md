# Weapons, pickups and the hook: design

Date: 2026-10-28. Status: for the owner's review. Extends `2026-10-25-planet-arena-design.md` (the main
spec) and `2026-10-27-comets-and-rings-design.md`, whose constraints all still hold. This brings part of
the main spec's stage 2 (weapons and pickups) into the single-player prototype.

## Intent

Give players reasons to travel round the solar system, and better ways to do it.

- **Pickups** on every planet and moon: health, weapons, ammo and extra booster fuel. You start with the
  pistol only, so getting stronger means going out and collecting.
- **Six weapons**, each with its own feel: the pistol, a shotgun, the rocket launcher, a minigun, a sniper
  rifle and a railgun.
- **A hook**: catch onto a nearby planet, moon or comet and pull yourself to it. The owner's two moments:
  "I'm on a planet with a moon and I want to grab some ammo on that moon, but I can't jump that high, and
  it wouldn't be worth it to use the rocket launcher to push me there because I would lose health"; and
  "I use a jump pad between planets, then realise I can grab onto a nearby comet and ride it."

Success: in the prototype the owner starts with the pistol, collects weapons, ammo, health and fuel round
the system, uses the hook to reach a moon and to catch a passing comet, and finds each weapon distinct.

## Goals

- Collecting things is a reason to move between bodies, and the best pickups reward risky or skilful
  travel.
- Each weapon has a clear use; none is simply better than another.
- The hook makes short hops (planet to its moon, flight to a passing comet) easy without making jump pads
  and the booster pointless.

## Non-goals

- Hooking other players (for now).
- Armour (the main spec: health only, to start).
- Pickups on comets.
- Bots, multiplayer and scoring: later stages, as in the main spec.
- Small asteroids from the belt that explode on planets: the owner's next idea, designed separately after
  this.

## Anti-goals (a failure even if it works)

- The hook as a free flight system: if you can chain hooks across the solar system, travel stops being a
  skill.
- One weapon that dominates every situation (the minigun is the likeliest).
- Surfaces cluttered with pickups, or pickups so sparse that nobody bothers.
- Running out of every weapon and being unable to fight: the pistol never runs out.

## The hook

The owner agreed to all of this.

- **Always carried**, on its own button (right mouse), not a weapon you switch to. You can fire it with
  any weapon in hand, and you never pick it up.
- **Aiming**: with the crosshair. It catches planets, moons and comets within 25 m, *owner*; not other
  players. Neighbouring planets do come within 25 m of each other at times (the hot and tiny planets get to
  19 m), so the hook is sometimes a shortcut between them; the owner accepts that.
- **Pulling**: while the button is held, the rope pulls you steadily towards the point it caught. Gravity
  still acts, so hooking straight up from a heavy planet is slower than hooking across. Reaching the
  surface, you land. A comet caught by the hook catches you as before when you reach it.
- **The rope never snaps**, *owner*: if what you caught moves away (a passing comet, an orbiting moon), the
  rope drags you along with it.
- **Letting go** releases the rope and you keep your speed, *owner*: let go at the right moment and you are
  flung off, a slingshot.
- **Limits**: no ammo; a short wait before it can fire again, counted from when you let go, so it can't be
  chained straight away. *Builder's call.*
- **Seen by others**: a visible line shows the rope.
- **In a fight**: you can shoot while hooked; a rocket blast doesn't break the rope.

## Pickups

The owner agreed to all of this; the parts marked *owner* are theirs word for word in substance.

- **Where**: scattered on the surface of every planet, *owner*; on moons too, with the strongest pickups
  in hard places to reach (the moon, the hot planet next to the sun), so the hook and risky jumps pay off.
- **Fixed spots**: each pickup has a set place, the same every match, so players learn routes.
- **Respawn**: each comes back a while after it is taken, *owner*. While it is gone, its spot shows a faint
  outline.
- **Taking one**: walk or land onto it.
- **Kinds**:
  - **Health**: restores part of your health, never above the maximum.
  - **Weapon**: gives the weapon with some ammo; if you have it already, just the ammo.
  - **Ammo**: one kind per weapon, coloured to match it.
  - **Booster fuel**, *owner*: fills the fuel above the usual maximum. The extra is used like normal fuel and
    is not permanent: once it is spent, the usual maximum is back, and standing on a body refills only up to
    the usual maximum.
- **Dying** loses everything but the pistol; you respawn with the pistol only, *owner*.
- The dummy doesn't take pickups.

## Weapons

Six, picked with keys 1 to 6 or the mouse wheel (which skips weapons you don't have).

| Weapon | How it shoots | Its place |
|---|---|---|
| Pistol | Precise bullets (120 m/s) that bend slightly with gravity over long shots; unlimited ammo | The start weapon; never empty |
| Shotgun | A spread of pellets; strong up close, weak at range; a small push on whoever is hit, not on you (*owner*) | Close fights |
| Rocket launcher | As now: slow rockets that curve with gravity, blast damage and knockback, rocket jumps | Knocking people off planets and into the sun |
| Minigun | Like the pistol but fast firing, with a bit more spread while staying precise; eats ammo | Sustained fire at middle range |
| Sniper rifle | Zooms (held key, not right mouse, which is the hook); a bullet so fast it is almost instant, bending a little over very long shots; slow and hard-hitting | Picking people off across the system |
| Railgun | Instant and dead straight, ignoring gravity; slow and very hard-hitting; a visible beam | Precise long shots, as in Quake |

The owner chose: shotgun and minigun join the main spec's four weapons; the minigun as described; the
sniper zooms and is almost instant; the railgun is instant and ignores gravity.

## Constraints

From the main spec and `CLAUDE.md`:

- Plain ES modules, three.js 0.160.0 from the import map, no bundler, no npm packages in the page.
- Every gameplay number lives in `src/tuning.js`; the existing property tests keep passing (change the
  numbers, not the property).
- `src/sim/` has no three.js or DOM imports, so a server can run the same code later.
- Fixed 1/60 s tick; orbits scripted from the clock.
- Simple, cartoonish look; own assets only.

## Left to the builder

- All numbers: damage, fire rates, spread, pellet count, ammo per pickup and the most you can carry,
  health per pack, the fuel pickup's extra amount, respawn times, hook range, pull speed and cooldown,
  zoom amount.
- Where exactly pickups go, how many per body, and which kinds where (within the rules above).
- The zoom key, and how pickups, the rope, the beam and the new weapons look.
- The HUD changes: at least ammo for the weapon in hand, the weapons you hold, and fuel above the usual
  maximum.
- Which tests prove the above.
