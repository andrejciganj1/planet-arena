// Players and the dummy: moving on round, moving bodies whose "down" differs everywhere.
//
// While grounded, `vel` is relative to the ground body and the entity is carried by the body's
// displacement, so standing still on an orbiting planet is exact. In the air `vel` is a world velocity.
// Anything that leaves the ground (jump, pad, blast, running off an edge) adds the body's velocity.
import { PLAYER, BOOST, DUMMY } from "../tuning.js";
import { add, sub, scale, dot, cross, len, norm, projectOnPlane, rotateAxis, rotateFromTo, clampLen, anyPerpendicular } from "./vec.js";
import { bodyPull, shapedGravity } from "./gravity.js";
import { surfaceInfo, sphereContacts } from "./collide.js";

export const NO_INPUT = Object.freeze({ move: [0, 0], jump: false, boost: false, fire: false, weapon: null, hook: false, zoom: false, yawDelta: 0, pitchDelta: 0 });

const MAX_PITCH = (89 * Math.PI) / 180;

export function createEntity(id, kind, pos, up) {
  const u = norm(up);
  return {
    id, kind, pos: [...pos], vel: [0, 0, 0], up: u, forward: anyPerpendicular(u), pitch: 0,
    groundId: null, fuel: BOOST.fuel, health: kind === "dummy" ? DUMMY.health : PLAYER.health,
    alive: true, respawnAt: 0, weapon: "pistol", cooldown: 0, lastHitBy: null, lastHitAt: -Infinity,
    // Everyone starts, and respawns, with the pistol only. ammo[w] is rounds left; the pistol never runs out.
    weapons: ["pistol"], ammo: {},
    hook: null, hookCooldown: 0, hookHeld: false, hookArmed: false,
    boostLock: false, padLockUntil: -Infinity, airTime: 0,
  };
}

// Puts an entity at rest on a body (spawns, pads). Its feet must already be on the surface.
export function standOn(e, bodyId) {
  e.groundId = bodyId;
  e.vel = [0, 0, 0];
}

export const hitCentre = (e) => add(e.pos, scale(e.up, PLAYER.radius));
export const right = (e) => cross(e.forward, e.up);
export const viewDir = (e) => add(scale(e.forward, Math.cos(e.pitch)), scale(e.up, Math.sin(e.pitch)));
export const worldVel = (world, e) => (e.groundId ? add(e.vel, world.poses[e.groundId].vel) : [...e.vel]);

// Leaves the ground: the relative velocity becomes a world one.
export function unground(world, e) {
  if (!e.groundId) return;
  e.vel = worldVel(world, e);
  e.groundId = null;
}

// Turns unit `from` towards unit `to` by at most `max` radians. Exactly opposite vectors turn about
// `fallback`, so the result never depends on a degenerate cross product.
function turnTowards(from, to, max, fallback) {
  const c = Math.min(1, Math.max(-1, dot(from, to)));
  const angle = Math.acos(c);
  if (angle <= max) return [...to];
  let axis = cross(from, to);
  axis = len(axis) > 1e-9 ? norm(axis) : fallback;
  return rotateAxis(from, axis, max);
}

export function stepEntity(world, e, input, dt) {
  const { system, poses } = world;
  const prev = world.prevPoses || poses;

  // 1. Look.
  if (input.yawDelta) e.forward = rotateAxis(e.forward, e.up, -input.yawDelta);
  e.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, e.pitch + (input.pitchDelta || 0)));
  e.cooldown = Math.max(0, e.cooldown - dt);

  // 2. Ride along with the ground.
  const wasGround = e.groundId;
  if (wasGround) e.pos = add(e.pos, sub(poses[wasGround].pos, prev[wasGround].pos));

  // 3. Gravity: only the ground body's while standing, so the sun can't drag you across the surface.
  // In the air the body pulling hardest also sets where "up" turns to (step 9).
  const air = wasGround ? null : shapedGravity(system, poses, hitCentre(e));
  const grav = air ? air.acc : bodyPull(system.byId[wasGround], poses[wasGround], hitCentre(e));
  e.vel = add(e.vel, scale(grav, dt));

  const [strafe, ahead] = input.move;
  const moving = strafe !== 0 || ahead !== 0;
  if (wasGround) {
    // 4. Run in the tangent plane, Quake style: accelerate towards the wished velocity, else friction.
    const n = surfaceInfo(system.byId[wasGround], poses[wasGround], hitCentre(e)).normal;
    const vn = dot(e.vel, n);
    let vt = sub(e.vel, scale(n, vn));
    if (moving) {
      const fwd = norm(projectOnPlane(e.forward, n)), rt = norm(projectOnPlane(right(e), n));
      const wish = scale(clampLen(add(scale(fwd, ahead), scale(rt, strafe)), 1), PLAYER.run);
      vt = add(vt, clampLen(sub(wish, vt), PLAYER.accel * dt));
    } else {
      vt = scale(vt, Math.max(0, 1 - PLAYER.friction * dt));
    }
    e.vel = add(vt, scale(n, vn));
    // Refill towards the usual tank, never lowering extra fuel from a pickup.
    if (e.fuel < BOOST.fuel) e.fuel = Math.min(BOOST.fuel, e.fuel + BOOST.refill * dt);
    if (input.jump) {
      e.vel = add(vt, scale(e.up, PLAYER.jump));
      unground(world, e);
      // Space jumps and, held in the air, boosts: the press that jumped must be released first.
      e.boostLock = !!input.boost;
    }
  } else {
    // 5. Booster.
    if (!input.boost) e.boostLock = false;
    else if (!e.boostLock && e.fuel > 0) {
      const dir = moving ? norm(add(scale(viewDir(e), ahead), scale(right(e), strafe))) : e.up;
      const burn = Math.min(dt, e.fuel);
      e.vel = add(e.vel, scale(dir, BOOST.accel * burn));
      e.fuel = Math.max(0, e.fuel - dt);
    }
  }

  // 6. Integrate.
  e.pos = add(e.pos, scale(e.vel, dt));

  // 7. Contacts (the sun kills on touch instead, see world.js). Work in world velocity here.
  let wv = worldVel(world, e);
  const contacts = sphereContacts(system, poses, hitCentre(e), PLAYER.radius).filter((c) => system.byId[c.id].kind !== "sun");
  let ground = null;
  const cosGround = Math.cos((PLAYER.groundAngle * Math.PI) / 180);
  for (const c of contacts) {
    e.pos = add(e.pos, scale(c.normal, c.depth));
    const bv = poses[c.id].vel;
    let rel = sub(wv, bv);
    const into = dot(rel, c.normal);
    if (into < 0) rel = sub(rel, scale(c.normal, into));
    wv = add(rel, bv);
    // 8. Standing if the surface is within groundAngle of up. A comet catches you at any angle: hitting
    // one is how you board it, so it must not bounce or skim you off. Up then turns to it as usual.
    const catches = system.byId[c.id].kind === "comet";
    if ((catches || dot(c.normal, e.up) >= cosGround) && (!ground || c.depth > ground.depth)) ground = c;
  }
  let groundId = ground ? ground.id : null;
  if (!groundId && wasGround && e.groundId) {
    // Stick to the surface while running over its curve, so speed alone can't fling you off.
    const s = surfaceInfo(system.byId[wasGround], poses[wasGround], hitCentre(e));
    const gap = s.dist - PLAYER.radius;
    if (gap < PLAYER.snap && (system.byId[wasGround].kind === "comet" || dot(s.normal, e.up) >= cosGround)) {
      e.pos = sub(e.pos, scale(s.normal, gap));
      let rel = sub(wv, poses[wasGround].vel);
      const out = dot(rel, s.normal);
      if (out > 0) rel = sub(rel, scale(s.normal, out));
      wv = add(rel, poses[wasGround].vel);
      groundId = wasGround;
    }
  }
  e.groundId = groundId;
  e.vel = groundId ? sub(wv, poses[groundId].vel) : wv;
  e.airTime = groundId ? 0 : e.airTime + dt;

  // 9. Turn up towards the ground's normal, or away from the body you are falling to.
  const c = hitCentre(e);
  const towards = groundId || (air ? air.dominant : shapedGravity(system, poses, c).dominant);
  const target = groundId
    ? surfaceInfo(system.byId[groundId], poses[groundId], c).normal
    : norm(scale(bodyPull(system.byId[towards], poses[towards], c), -1));
  if (len(target) > 0.5) {
    const oldUp = e.up;
    e.up = turnTowards(oldUp, target, PLAYER.upTurn * dt, norm(right(e)));
    e.forward = rotateFromTo(e.forward, oldUp, e.up);
  }

  // 10. Re-orthonormalise.
  e.up = norm(e.up);
  const f = projectOnPlane(e.forward, e.up);
  e.forward = len(f) > 1e-6 ? norm(f) : anyPerpendicular(e.up);
}
