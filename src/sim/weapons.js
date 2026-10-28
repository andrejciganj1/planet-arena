// The weapons. Every projectile falls with the same shaped gravity as players, and is swept along its
// tick segment so fast bullets can't pass through thin chords of a planet.
import { add, sub, scale, dist, norm, len, cross, anyPerpendicular } from "./vec.js";
import { gravityAt } from "./gravity.js";
import { segmentHit, segmentHitsSphere } from "./collide.js";
import { viewDir, worldVel, hitCentre, unground } from "./entity.js";

const specOf = (world, kind) => world.tuning.WEAPONS[kind];

// Fires e's weapon from the eye along the view, adding e's own velocity. False while cooling down or
// out of ammo. Spends a round; an emptied weapon hands you the pistol, which never runs out.
export function fire(world, e) {
  if (e.cooldown > 0 || !e.alive) return false;
  const spec = specOf(world, e.weapon);
  if (spec.ammo && !(e.ammo[e.weapon] > 0)) {
    e.weapon = "pistol";
    return false;
  }
  const eye = add(e.pos, scale(e.up, world.tuning.PLAYER.eye));
  if (spec.type === "ray") rail(world, e, eye, viewDir(e), spec);
  else {
    for (let i = 0; i < (spec.pellets || 1); i++) {
      world.projectiles.push({
        kind: e.weapon, owner: e.id, age: 0, pos: eye, range: spec.range, push: spec.push,
        vel: add(scale(spread(world, viewDir(e), spec.spread), spec.speed), worldVel(world, e)),
      });
    }
  }
  e.cooldown = spec.cooldown;
  e.shots++;
  if (spec.ammo && --e.ammo[e.weapon] <= 0) e.weapon = "pistol";
  return true;
}

// dir turned by up to `deg` degrees, spread evenly over the cone's disc.
function spread(world, dir, deg) {
  if (!deg) return dir;
  const theta = ((deg * Math.PI) / 180) * Math.sqrt(world.rand()), phi = 2 * Math.PI * world.rand();
  const u = anyPerpendicular(dir), v = cross(dir, u);
  return norm(add(scale(dir, Math.cos(theta)), scale(add(scale(u, Math.cos(phi)), scale(v, Math.sin(phi))), Math.sin(theta))));
}

// The railgun: instant and dead straight, ignoring gravity. The first body or entity on the line takes it.
function rail(world, e, eye, dir, spec) {
  const { system, poses, tuning } = world;
  const end = add(eye, scale(dir, spec.range));
  let hit = segmentHit(system, poses, eye, end);
  for (const o of Object.values(world.entities)) {
    if (!o.alive || o === e) continue;
    const f = segmentHitsSphere(eye, end, hitCentre(o), tuning.PLAYER.radius);
    if (f !== null && (!hit || f < hit.f)) hit = { entity: o, f };
  }
  const to = hit ? add(eye, scale(sub(end, eye), hit.f)) : end;
  if (hit?.entity) hurt(world, hit.entity, spec.damage, e.id);
  world.beams.push({ from: eye, to, age: 0, owner: e.id });
  world.events.push({ type: "beam", from: eye, to });
}

function hurt(world, e, damage, byId) {
  e.health -= damage;
  if (byId && byId !== e.id) {
    e.lastHitBy = byId;
    e.lastHitAt = world.t;
  }
  world.events.push({ type: "hit", id: e.id, damage });
}

// Splash damage and knockback, both falling off linearly to zero at the splash radius. The shooter
// takes reduced damage but full knockback, which is what makes rocket jumps work.
export function explode(world, pos, ownerId) {
  const { ROCKET } = world.tuning;
  world.events.push({ type: "explode", pos: [...pos] });
  world.explosions.push({ pos: [...pos], age: 0 });
  for (const e of Object.values(world.entities)) {
    if (!e.alive) continue;
    const c = hitCentre(e);
    const d = dist(c, pos);
    if (d >= ROCKET.splash) continue;
    const f = 1 - d / ROCKET.splash;
    const away = d > 1e-6 ? norm(sub(c, pos)) : e.up;
    unground(world, e);
    e.vel = add(e.vel, scale(away, ROCKET.knockback * f));
    hurt(world, e, ROCKET.damage * f * (e.id === ownerId ? ROCKET.self : 1), ownerId);
  }
}

export function stepProjectiles(world, dt) {
  const { PLAYER, SHOT, VOID_RADIUS } = world.tuning;
  const { system, poses } = world;
  const sun = system.bodies.find((b) => b.kind === "sun");
  const keep = [];
  for (const p of world.projectiles) {
    p.vel = add(p.vel, scale(gravityAt(system, poses, p.pos), dt));
    const next = add(p.pos, scale(p.vel, dt));
    // Shotgun pellets only carry so far.
    if (p.range !== undefined && (p.range -= len(sub(next, p.pos))) < 0) continue;
    let hit = segmentHit(system, poses, p.pos, next);
    for (const e of Object.values(world.entities)) {
      if (!e.alive || (e.id === p.owner && p.age < SHOT.ownerGrace)) continue;
      const f = segmentHitsSphere(p.pos, next, hitCentre(e), PLAYER.radius);
      if (f !== null && (!hit || f < hit.f)) hit = { entity: e, f, point: add(p.pos, scale(sub(next, p.pos), f)) };
    }
    p.age += dt;
    if (!hit) {
      p.pos = next;
      if (dist(next, poses[sun.id].pos) < VOID_RADIUS) keep.push(p);
      continue;
    }
    if (hit.id === sun.id) continue; // the sun swallows everything
    if (p.kind === "rocket") explode(world, hit.point, p.owner);
    else if (hit.entity) {
      hurt(world, hit.entity, specOf(world, p.kind).damage, p.owner);
      // A pellet's push goes to whoever it hits, never back to the shooter.
      if (p.push) {
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
