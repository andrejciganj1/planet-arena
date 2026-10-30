// Messages between browser and server (JSON), and the cleaning that stands between untrusted network data
// and the shared world. Browser to server: { type: "hello", v, name, nonce, token? } and { type: "input",
// tick, view, input }. Server to browser: { type: "welcome", id, token, tick, t, colour }, { type: "full" },
// { type: "version" } and snapshots.
import { WEAPON_ORDER, NET } from "../tuning.js";
import { NO_INPUT } from "../sim/entity.js";

// Bumped whenever the rules change, so an older page is told to reload (5: solar flares).
export const PROTOCOL = 5;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const axis = (x) => (num(x) ? clamp(x, -1, 1) : 0);
const angle = (x) => (num(x) ? clamp(x, -Math.PI, Math.PI) : 0);
const flag = (x) => x === true;

// A usable input record or null. Nothing returned can hold NaN, Infinity or a wrong type, and `lag` is
// always 0: the server sets it from what it knows, never from the client.
export function cleanInput(raw) {
  if (!raw || typeof raw !== "object" || !Number.isSafeInteger(raw.tick) || raw.tick < 0) return null;
  const move = Array.isArray(raw.move) ? raw.move : [];
  return {
    ...NO_INPUT,
    move: [axis(move[0]), axis(move[1])],
    jump: flag(raw.jump), boost: flag(raw.boost), fire: flag(raw.fire), hook: flag(raw.hook), zoom: flag(raw.zoom),
    weapon: WEAPON_ORDER.includes(raw.weapon) ? raw.weapon : null,
    yawDelta: angle(raw.yawDelta), pitchDelta: angle(raw.pitchDelta),
    tick: raw.tick,
    view: Number.isSafeInteger(raw.view) && raw.view >= 0 && raw.view <= raw.tick ? raw.view : raw.tick,
  };
}

// Plain text of at most NET.nameMax characters; a name already taken (ignoring case) gets " 2", " 3", ...
export function cleanName(raw, taken = []) {
  const base = (typeof raw === "string" ? raw : num(raw) ? String(raw) : "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim().slice(0, NET.nameMax).trim() || "Player";
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = base.slice(0, NET.nameMax - suffix.length).trimEnd() + suffix;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// JSON has no infinities, and entities start with some (lastHitAt, padLockUntil).
const encode = (v) =>
  v === Infinity ? "inf" : v === -Infinity ? "-inf"
  : Array.isArray(v) ? v.map(encode)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
  : v;
const decode = (v) =>
  v === "inf" ? Infinity : v === "-inf" ? -Infinity
  : Array.isArray(v) ? v.map(decode)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
  : v;

// Every field but `prev`, which is for drawing only.
export function entityState(e) {
  const { prev, ...rest } = e;
  return encode(rest);
}

export function applyEntity(e, rec) {
  Object.assign(e, decode(rec));
  e.prev = undefined;
  delete e.prev;
}

// away: players inside their reconnect window, { id, name, colour }, listed with `away: true`.
export function snapshot(world, { ack, slack, events, away = [] }) {
  const pickups = {};
  for (const [id, p] of Object.entries(world.pickups)) pickups[id] = p.readyAt;
  const players = {};
  for (const [id, p] of Object.entries(world.players)) {
    const s = world.scores[id] || { kills: 0, deaths: 0 };
    players[id] = { name: p.name, colour: p.colour, kills: s.kills, deaths: s.deaths };
  }
  for (const a of away) {
    const s = world.scores[a.id] || { kills: 0, deaths: 0 };
    players[a.id] = { name: a.name, colour: a.colour, kills: s.kills, deaths: s.deaths, away: true };
  }
  return {
    type: "snap", tick: world.tick, t: world.t, ack, slack,
    entities: Object.values(world.entities).map(entityState),
    shots: world.projectiles.map(({ id, kind, owner, pos, vel }) => ({ id, kind, owner, pos: [...pos], vel: [...vel] })),
    rocks: world.asteroids.map(({ id, pos, vel, owner }) => ({ id, pos: [...pos], vel: [...vel], owner })),
    pickups, players,
    beams: world.beams.map((b) => ({ ...b, from: [...b.from], to: [...b.to] })),
    events,
  };
}
