// What to play: sounds from the events the simulation pushes and from what changed since the last frame
// (shot counts, weapons, the hook, fuel, footsteps, pickups coming back). No Web Audio or DOM here, so node
// tests load it; the mixer plays what a frame returns. pos null means in your head (no panning).
import { SOUND } from "../tuning.js";
import { add, scale, len } from "../sim/vec.js";
import { pickupPos } from "../sim/pickups.js";

// Every sound there is; the firing sounds share their weapon's name. Loops: rocketFlight, rockIncoming,
// hookPull, boost.
export const SOUNDS = [
  "pistol", "shotgun", "rocket", "minigun", "sniper", "railgun", "rocketFlight", "explode", "rockIncoming", "rockBurn",
  "ding", "hurt", "death", "announcer", "boink", "pickup", "pickupBack", "step", "hookFire", "hookPull", "boost",
  "switch", "empty",
];

const ALWAYS = { get: () => true };

// online: events marked `remote` came from the server, and the ones about your own pad launches and rocket
// blasts were already played from your prediction.
export function createDirector({ selfId, online }) {
  const seen = new Map(); // entity id -> what it was last frame
  let ready = new Map(); // pickup id -> readyAt last frame
  let lastT = null, spots = null;
  const mineShot = (id) => typeof id === "string" && id.startsWith(`${selfId}.`);

  function fromEvents(world, events, settings, once) {
    const at = (id) => world.entities[id]?.pos;
    for (const ev of events) {
      const echo = online && ev.remote;
      switch (ev.type) {
        case "hit":
          // Your own blast hurts you but is no hit to confirm.
          if (ev.id === selfId) once.push({ name: "hurt", pos: null, own: true });
          else if (ev.by === selfId && settings.get("hits")) once.push({ name: "ding", pos: null, own: true });
          break;
        case "death":
          if (ev.id === selfId) once.push({ name: "death", pos: null, own: true });
          else once.push({ name: "death", pos: ev.pos, own: false });
          // A sun kill is an event for the whole game: the killer hears it full, everyone else quieter.
          if (ev.cause === "sun" && ev.by) {
            if (ev.by === selfId) once.push({ name: "announcer", pos: null, own: true });
            else once.push({ name: "announcer", pos: null, own: false, gain: SOUND.announcerOthers });
          }
          break;
        case "explode":
          if (echo && mineShot(ev.id)) break;
          once.push({ name: "explode", pos: ev.pos, own: mineShot(ev.id) });
          break;
        case "burn":
          if (ev.pos) once.push({ name: "rockBurn", pos: ev.pos, own: false });
          break;
        case "launch":
          if (echo && ev.id === selfId) break;
          if (at(ev.id)) once.push({ name: "boink", pos: at(ev.id), own: ev.id === selfId });
          break;
        case "pickup":
          if (at(ev.id)) once.push({ name: "pickup", pos: at(ev.id), own: ev.id === selfId });
          break;
        case "beam":
          // Your own railgun sounds from your shot count, at once; another's from its beam.
          if (ev.owner !== selfId) once.push({ name: "railgun", pos: ev.from, own: false });
          break;
      }
    }
  }

  // One entity's changes since last frame. `quiet` (a gap, a reset, first seen, a respawn) only remembers.
  function fromEntity(world, e, was, quiet, dt, once, loops) {
    const { PLAYER, WEAPONS } = world.tuning;
    const mine = e.id === selfId, eye = add(e.pos, scale(e.up, PLAYER.eye));
    // The highest count heard, so a count a server correction put back doesn't sound again.
    const now = {
      ref: e, shots: was?.ref === e ? Math.max(was.shots, e.shots) : e.shots, weapon: e.weapon, hook: !!e.hook,
      fuel: e.fuel, alive: e.alive, stride: 0, boostUntil: -Infinity,
    };
    if (!quiet) {
      // The last round hands over the pistol in the same tick: that shot was the old weapon's.
      const emptied = e.weapon !== was.weapon && !!WEAPONS[was.weapon]?.ammo && !(e.ammo?.[was.weapon] > 0);
      const gun = emptied ? was.weapon : e.weapon;
      // Another's railgun sounds from its beam event instead.
      if (mine || gun !== "railgun") for (let k = was.shots; k < e.shots; k++) once.push({ name: gun, pos: eye, own: mine });
      if (mine && e.weapon !== was.weapon) once.push({ name: emptied ? "empty" : "switch", pos: null, own: true });
      if (e.hook && !was.hook) once.push({ name: "hookFire", pos: eye, own: mine });
      const speed = len(e.vel);
      if (e.alive && e.groundId && speed > SOUND.stepSpeed) {
        now.stride = was.stride + speed * dt;
        if (now.stride >= SOUND.stride) {
          now.stride %= SOUND.stride;
          once.push({ name: "step", pos: e.pos, own: mine });
        }
      }
      if (e.alive && !e.groundId) now.boostUntil = e.fuel < was.fuel ? world.t + SOUND.hold : was.boostUntil;
    }
    // Loops say what is going on now, so they hold even on a quiet frame.
    if (e.alive && e.hook) loops.set(`hook:${e.id}`, { name: "hookPull", pos: eye, own: mine });
    if (e.alive && !e.groundId && world.t < now.boostUntil) loops.set(`boost:${e.id}`, { name: "boost", pos: e.pos, own: mine });
    return now;
  }

  function frame(world, events, dt, settings = ALWAYS) {
    const once = [], loops = new Map();
    // A hidden tab coming back, a restarted server or a resynced clock: what changed in between is old news.
    const gap = lastT === null || dt > SOUND.gap || world.t < lastT || world.t - lastT > SOUND.gap;
    const ticked = gap ? 0 : world.t - lastT; // game time, so a frame that ran no tick walks no distance

    fromEvents(world, events, settings, once);

    const present = new Set();
    for (const e of Object.values(world.entities)) {
      const was = seen.get(e.id);
      const quiet = gap || !was || was.ref !== e || (!was.alive && e.alive);
      seen.set(e.id, fromEntity(world, e, was, quiet, ticked, once, loops));
      present.add(e.id);
    }
    for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);

    spots ||= new Map(world.tuning.PICKUPS.map((p) => [p.id, p]));
    const next = new Map();
    for (const [id, { readyAt }] of Object.entries(world.pickups)) {
      next.set(id, readyAt);
      // Only a wait that ends between two frames; a new readyAt is a pickup just taken.
      const spot = spots.get(id);
      if (!gap && spot && ready.get(id) === readyAt && lastT < readyAt && readyAt <= world.t) {
        once.push({ name: "pickupBack", pos: pickupPos(world, spot, world.poses), own: false });
      }
    }
    ready = next;

    for (const p of world.projectiles) {
      if (p.kind === "rocket") loops.set(`rocket:${p.id}`, { name: "rocketFlight", pos: p.pos, own: p.owner === selfId });
    }
    for (const r of world.asteroids || []) loops.set(`rock:${r.id}`, { name: "rockIncoming", pos: r.pos, own: false });

    lastT = world.t;
    return { once, loops };
  }

  return { frame };
}
