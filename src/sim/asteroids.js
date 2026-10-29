// Asteroids: rocks that break off the belt and fall in under the same gravity as everything else. Launch k
// comes at k * every, from a point and in a direction picked by a pure hash of k, so solo games and the
// server make the same rocks at the same times whatever else has drawn from the world's dice.
import { add, sub, scale, dist } from "./vec.js";
import { gravityAt } from "./gravity.js";
import { segmentHit, segmentHitsSphere, surfaceInfo } from "./collide.js";
import { posesAt } from "./system.js";
import { hitSpheres } from "./entity.js";
import { hashRand, detonate } from "./weapons.js";

const DEG = Math.PI / 180;

// Launch k: { id, pos, vel }, or null when its point is in or near a body then (nothing launches for k).
// The velocity is the belt's own turn there (as drawn) plus a kick in a random direction near the plane and
// roughly sunward (ASTEROID.aim), so most fall to the sun rather than onto the heavy planet next door.
export function launchOf(tuning, system, k) {
  const { ASTEROID, BELT } = tuning;
  const t = k * ASTEROID.every, next = hashRand(`rock|${k}`);
  const r = BELT.inner + next() * (BELT.outer - BELT.inner), a = next() * 2 * Math.PI, y = (next() - 0.5) * BELT.thick;
  const pos = [r * Math.cos(a), y, r * Math.sin(a)];
  const poses = posesAt(system, t);
  if (system.bodies.some((b) => surfaceInfo(b, poses[b.id], pos).dist < ASTEROID.radius + ASTEROID.clear)) return null;
  const w = (2 * Math.PI) / BELT.period, belt = [-w * pos[2], 0, w * pos[0]];
  const sunward = Math.atan2(-pos[2], -pos[0]);
  const heading = sunward + (2 * next() - 1) * ASTEROID.aim * DEG, el = (2 * next() - 1) * ASTEROID.tilt * DEG;
  const speed = ASTEROID.speed[0] + next() * (ASTEROID.speed[1] - ASTEROID.speed[0]);
  const dir = [Math.cos(el) * Math.cos(heading), Math.sin(el), Math.cos(el) * Math.sin(heading)];
  return { id: `rock.${k}`, pos, vel: add(belt, scale(dir, speed)) };
}

// Launches whatever is due, then moves each rock along its tick segment: the first body or entity it meets
// sets it off there (the sun just burns it); one that leaves the system or gets old is dropped quietly.
export function stepAsteroids(world, dt) {
  const { ASTEROID, VOID_RADIUS } = world.tuning;
  const { system, poses } = world;
  while ((world.rocksLaunched + 1) * ASTEROID.every <= world.t + 1e-9) {
    const k = ++world.rocksLaunched;
    if (k * ASTEROID.every <= world.t - dt + 1e-9) continue; // due before the last tick: the clock was set forward
    const rock = launchOf(world.tuning, system, k);
    if (rock) world.asteroids.push({ ...rock, age: 0, owner: null });
  }
  const sun = system.bodies.find((b) => b.kind === "sun");
  for (const rock of [...world.asteroids]) {
    if (!world.asteroids.includes(rock)) continue; // set off this tick by another rock's blast
    rock.vel = add(rock.vel, scale(gravityAt(system, poses, rock.pos), dt));
    const next = add(rock.pos, scale(rock.vel, dt));
    rock.age += dt;
    let hit = segmentHit(system, poses, rock.pos, next, ASTEROID.radius);
    for (const e of Object.values(world.entities)) {
      if (!e.alive) continue;
      for (const [c, r] of hitSpheres(e.pos, e.up)) {
        const f = segmentHitsSphere(rock.pos, next, c, r + ASTEROID.radius);
        if (f !== null && (!hit || f < hit.f)) hit = { f };
      }
    }
    if (hit) {
      rock.pos = add(rock.pos, scale(sub(next, rock.pos), hit.f));
      if (hit.id !== sun.id) detonate(world, rock, null, 0);
      else {
        world.asteroids = world.asteroids.filter((r) => r !== rock);
        world.events.push({ type: "burn", id: rock.id });
      }
      continue;
    }
    rock.pos = next;
    if (dist(next, poses[sun.id].pos) > VOID_RADIUS || rock.age > ASTEROID.life) world.asteroids = world.asteroids.filter((r) => r !== rock);
  }
}
