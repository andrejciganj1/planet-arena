// Pickups: health, weapons, ammo and extra booster fuel at fixed spots on the bodies. Players take one by
// standing on it, but only when it helps them, so a full player leaves it for someone who needs it.
import { add, scale, dist } from "./vec.js";
import { radiusAt } from "./shape.js";

export function pickupPos(world, pickup, poses) {
  return add(poses[pickup.body].pos, scale(pickup.dir, radiusAt(world.system.byId[pickup.body], pickup.dir)));
}

export const pickupReady = (world, pickup) => world.t >= (world.pickups[pickup.id]?.readyAt ?? 0);

// Applies the pickup to e if it helps; returns whether it did.
function take(world, e, pk) {
  const { PICKUP, BOOST, PLAYER, WEAPONS } = world.tuning;
  const ammo = pk.weapon && WEAPONS[pk.weapon].ammo;
  const add = (n) => (e.ammo[pk.weapon] = Math.min(ammo.max, (e.ammo[pk.weapon] || 0) + n));
  switch (pk.kind) {
    case "health":
      if (e.health >= PLAYER.health) return false;
      e.health = Math.min(PLAYER.health, e.health + PICKUP.health);
      return true;
    case "fuel":
      if (e.fuel >= BOOST.fuel * PICKUP.fuelMax) return false;
      e.fuel = BOOST.fuel * PICKUP.fuelMax;
      return true;
    case "weapon":
      if (e.weapons.includes(pk.weapon)) {
        if ((e.ammo[pk.weapon] || 0) >= ammo.max) return false;
        add(ammo.pickup);
        return true;
      }
      e.weapons.push(pk.weapon);
      add(ammo.pickup);
      e.weapon = pk.weapon; // a new weapon goes straight into your hand
      return true;
    case "ammo":
      if ((e.ammo[pk.weapon] || 0) >= ammo.max) return false;
      add(ammo.box);
      return true;
  }
  return false;
}

export function stepPickups(world) {
  const { PICKUP, PICKUPS } = world.tuning;
  for (const pk of PICKUPS) {
    if (!pickupReady(world, pk)) continue;
    const at = pickupPos(world, pk, world.poses);
    for (const e of Object.values(world.entities)) {
      if (e.kind !== "player" || !e.alive || dist(e.pos, at) >= PICKUP.touch) continue;
      if (!take(world, e, pk)) continue;
      world.pickups[pk.id] = { readyAt: world.t + PICKUP.respawn[pk.kind] };
      world.events.push({ type: "pickup", id: e.id, pickupId: pk.id });
      break;
    }
  }
}
