// The weapons. Every projectile falls with the same shaped gravity as players, and is swept along its
// tick segment so fast bullets can't pass through thin chords of a planet.
import { add, sub, scale, dist, norm, len, cross, anyPerpendicular } from "./vec.js";
import { gravityAt } from "./gravity.js";
import { segmentHit, segmentHitsSphere } from "./collide.js";
import { viewDir, worldVel, unground, segmentHitsPlayer, nearestSphere } from "./entity.js";
import { seenPose, seenRock } from "./lag.js";

const specOf = (world, kind) => world.tuning.WEAPONS[kind];

// Fires e's weapon from the eye along the view, adding e's own velocity. False while cooling down or
// out of ammo. `lag` is the shooter's view delay in seconds, kept on the projectile for the server's
// compensation. Every projectile is named by shooter, shot number and pellet, so the browser and the
// server agree on which is which. Spends a round; an emptied weapon hands you the pistol, which never runs out.
export function fire(world, e, lag = 0) {
  if (e.cooldown > 0 || !e.alive) return false;
  const spec = specOf(world, e.weapon);
  if (spec.ammo && !(e.ammo[e.weapon] > 0)) {
    e.weapon = "pistol";
    return false;
  }
  const eye = add(e.pos, scale(e.up, world.tuning.PLAYER.eye));
  if (spec.type === "ray") rail(world, e, eye, viewDir(e), spec, `${e.id}.${e.shots}.0`, lag);
  else {
    for (let k = 0; k < (spec.pellets || 1); k++) {
      const id = `${e.id}.${e.shots}.${k}`;
      world.projectiles.push({
        id, kind: e.weapon, owner: e.id, age: 0, pos: eye, range: spec.range, push: spec.push, lag, from: eye,
        vel: add(scale(spread(viewDir(e), spec.spread, shotRand(e.id, e.shots, k)), spec.speed), worldVel(world, e)),
      });
    }
  }
  e.cooldown = spec.cooldown;
  e.shots++;
  if (spec.ammo && --e.ammo[e.weapon] <= 0) e.weapon = "pistol";
  return true;
}

// Numbers in [0, 1) from a pure hash of `key` (FNV-1a into the same LCG as `seeded`), for dice that must
// never depend on how many other random draws the world has made.
export function hashRand(key) {
  let h = 0x811c9dc5;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return () => (h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// Two for a pellet's spread, from shooter, shot and pellet.
function shotRand(id, shots, k) {
  const next = hashRand(`${id}|${shots}|${k}`);
  return [next(), next()];
}

// dir turned by up to `deg` degrees, spread evenly over the cone's disc.
function spread(dir, deg, [r1, r2]) {
  if (!deg) return dir;
  const theta = ((deg * Math.PI) / 180) * Math.sqrt(r1), phi = 2 * Math.PI * r2;
  const u = anyPerpendicular(dir), v = cross(dir, u);
  return norm(add(scale(dir, Math.cos(theta)), scale(add(scale(u, Math.cos(phi)), scale(v, Math.sin(phi))), Math.sin(theta))));
}

// The railgun: instant and dead straight, ignoring gravity. The first body, entity or rock on the line takes
// it, each entity and rock where the shooter saw it (`lag`).
function rail(world, e, eye, dir, spec, id, lag) {
  const { system, poses } = world;
  const end = add(eye, scale(dir, spec.range));
  let hit = segmentHit(system, poses, eye, end);
  for (const o of Object.values(world.entities)) {
    if (!o.alive || o === e) continue;
    const s = seenPose(world, o, lag), f = segmentHitsPlayer(eye, end, s.pos, s.up);
    if (f !== null && (!hit || f < hit.f)) hit = { entity: o, f };
  }
  for (const rock of world.asteroids || []) {
    const f = segmentHitsSphere(eye, end, seenRock(world, rock, lag), world.tuning.ASTEROID.radius);
    if (f !== null && (!hit || f < hit.f)) hit = { rock, f };
  }
  const to = hit ? add(eye, scale(sub(end, eye), hit.f)) : end;
  if (hit?.entity) hurt(world, hit.entity, spec.damage, e.id, eye);
  else if (hit?.rock) detonate(world, hit.rock, e.id, lag);
  world.beams.push({ id, from: eye, to, age: 0, owner: e.id });
  world.events.push({ type: "beam", from: eye, to, owner: e.id });
}

// `from` is where the hit came from (the shooter's eye or the blast), for the victim's damage cue. The
// browser's cosmetic copy of the world never hurts anyone: only the server decides that.
function hurt(world, e, damage, byId, from) {
  if (world.cosmetic) return;
  e.health -= damage;
  if (byId && byId !== e.id) {
    e.lastHitBy = byId;
    e.lastHitAt = world.t;
  }
  world.events.push({ type: "hit", id: e.id, damage, by: byId, from: [...from] });
}

// Splash damage and knockback, both falling off linearly to zero at the splash radius. The shooter
// takes reduced damage but full knockback, which is what makes rocket jumps work. Everyone but the owner is
// measured where the shooter saw them (`lag`); the push is added to their current velocity. A cosmetic world
// pushes only you, so your own rocket jump feels right at once, and says how hard through onSelfPush.
// `id` is the rocket's, so the browser can tell the server's blast from the one it drew already. `spec` is
// the blast's size (a rocket's or an asteroid's). Rocks it reaches go off too, as the blast owner's, except
// in a cosmetic world: there only the server sets rocks off, and its explode events draw their blasts.
export function explode(world, pos, ownerId, lag = 0, id = null, spec = world.tuning.ROCKET) {
  world.events.push({ type: "explode", pos: [...pos], id });
  world.explosions.push({ pos: [...pos], age: 0, splash: spec.splash }); // splash: drawn at its real reach
  for (const e of Object.values(world.entities)) {
    if (!e.alive) continue;
    if (world.cosmetic && e.id !== world.selfId) continue;
    const s = e.id === ownerId ? e : seenPose(world, e, lag);
    const { centre: c, d } = nearestSphere(pos, s.pos, s.up);
    if (d >= spec.splash) continue;
    const f = 1 - d / spec.splash;
    const away = d > 1e-6 ? norm(sub(c, pos)) : e.up;
    unground(world, e);
    const dv = scale(away, spec.knockback * f);
    e.vel = add(e.vel, dv);
    if (world.cosmetic) world.onSelfPush?.(dv);
    hurt(world, e, spec.damage * f * (e.id === ownerId ? spec.self : 1), ownerId, pos);
  }
  if (world.cosmetic) return;
  const reach = spec.splash + world.tuning.ASTEROID.radius;
  const reached = (world.asteroids || []).filter((r) => dist(seenRock(world, r, lag), pos) < reach);
  // A rock is gone before its own blast, so a chain never comes back to it, and always ends.
  for (const rock of reached) if (world.asteroids.includes(rock)) detonate(world, rock, ownerId, lag);
}

// Sets a rock off where the shooter saw it (`lag`). Its blast is ownerId's, or nobody's (null) for one that
// hit something on its own: then `hurt` leaves the last hitter in place, as a fall into the sun does. A
// cosmetic world leaves the rock for the server: the shot that met it just stops there, with no blast.
export function detonate(world, rock, ownerId, lag = 0) {
  if (world.cosmetic) return;
  const at = seenRock(world, rock, lag);
  world.asteroids = world.asteroids.filter((r) => r !== rock);
  rock.owner = ownerId;
  explode(world, at, ownerId, lag, rock.id, world.tuning.ASTEROID.blast);
}

export function stepProjectiles(world, dt) {
  const { SHOT, VOID_RADIUS, ASTEROID } = world.tuning;
  const { system, poses } = world;
  const sun = system.sun;
  const keep = [];
  for (const p of world.projectiles) {
    p.vel = add(p.vel, scale(gravityAt(system, poses, p.pos), dt));
    const next = add(p.pos, scale(p.vel, dt));
    // Shotgun pellets only carry so far.
    if (p.range !== undefined && (p.range -= len(sub(next, p.pos))) < 0) continue;
    let hit = segmentHit(system, poses, p.pos, next);
    for (const e of Object.values(world.entities)) {
      if (!e.alive || (e.id === p.owner && p.age < SHOT.ownerGrace)) continue;
      const s = e.id === p.owner ? e : seenPose(world, e, p.lag), f = segmentHitsPlayer(p.pos, next, s.pos, s.up);
      if (f !== null && (!hit || f < hit.f)) hit = { entity: e, f, point: add(p.pos, scale(sub(next, p.pos), f)) };
    }
    // Any shot stops at a rock, where the shooter saw it.
    for (const rock of world.asteroids || []) {
      const f = segmentHitsSphere(p.pos, next, seenRock(world, rock, p.lag), ASTEROID.radius);
      if (f !== null && (!hit || f < hit.f)) hit = { rock, f, point: add(p.pos, scale(sub(next, p.pos), f)) };
    }
    p.age += dt;
    if (!hit) {
      p.pos = next;
      if (dist(next, poses[sun.id].pos) < VOID_RADIUS) keep.push(p);
      continue;
    }
    if (hit.id === sun.id) continue; // the sun swallows everything
    if (p.kind === "rocket") explode(world, hit.point, p.owner, p.lag, p.id); // a rock it hit goes off in the blast
    else if (hit.rock) detonate(world, hit.rock, p.owner, p.lag);
    else if (hit.entity) {
      hurt(world, hit.entity, specOf(world, p.kind).damage, p.owner, p.from || p.pos);
      // A pellet's push goes to whoever it hits, never back to the shooter.
      if (p.push && !world.cosmetic) {
        unground(world, hit.entity);
        hit.entity.vel = add(hit.entity.vel, scale(norm(sub(next, p.pos)), p.push));
      }
    }
  }
  world.projectiles = keep;
  for (const b of world.beams) b.age += dt;
  world.beams = world.beams.filter((b) => b.age < world.tuning.WEAPONS.railgun.showFor);
  for (const x of world.explosions) x.age += dt;
  world.explosions = world.explosions.filter((x) => x.age < world.tuning.ROCKET.showFor);
}
