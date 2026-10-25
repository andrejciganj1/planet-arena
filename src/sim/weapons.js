// The pistol and the rocket launcher. Every projectile falls with the same shaped gravity as players,
// and is swept along its tick segment so fast bullets can't pass through thin chords of a planet.
import { add, sub, scale, dist, norm } from "./vec.js";
import { gravityAt } from "./gravity.js";
import { segmentHit, segmentHitsSphere } from "./collide.js";
import { viewDir, worldVel, hitCentre, unground } from "./entity.js";

const specOf = (world, kind) => (kind === "rocket" ? world.tuning.ROCKET : world.tuning.PISTOL);

// Fires e's weapon from the eye along the view, adding e's own velocity. False while cooling down.
export function fire(world, e) {
  if (e.cooldown > 0 || !e.alive) return false;
  const spec = specOf(world, e.weapon);
  world.projectiles.push({
    kind: e.weapon, owner: e.id, age: 0,
    pos: add(e.pos, scale(e.up, world.tuning.PLAYER.eye)),
    vel: add(scale(viewDir(e), spec.speed), worldVel(world, e)),
  });
  e.cooldown = spec.cooldown;
  return true;
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
    else if (hit.entity) hurt(world, hit.entity, specOf(world, p.kind).damage, p.owner);
  }
  world.projectiles = keep;
  for (const x of world.explosions) x.age += dt;
  world.explosions = world.explosions.filter((x) => x.age < world.tuning.ROCKET.showFor);
}
