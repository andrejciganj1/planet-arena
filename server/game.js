// The game room: one world, its players, their inputs and the snapshots going back. Plain functions over
// connection handles (any value usable as a Map key), no sockets, so tests drive it directly. It is the
// only place that turns untrusted messages into simulation input.
import { randomUUID } from "node:crypto";
import { NET, COLOURS, TICK } from "../src/tuning.js";
import { createWorld, addPlayer, removePlayer, stepWorld } from "../src/sim/world.js";
import { NO_INPUT } from "../src/sim/entity.js";
import { PROTOCOL, cleanInput, cleanName, snapshot } from "../src/net/protocol.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const rejoinTicks = Math.round(NET.rejoin / TICK);

export function createGame(tuning, { token = () => randomUUID() } = {}) {
  let world = null;
  let nextId = 1;
  const conns = new Map(); // conn -> { id, token, nonce, pending, lastInput, ack, newest }
  const away = new Map(); // token -> { id, name, colour, score, shots, until } (until: world tick)

  function colourFor() {
    const order = [...COLOURS.slice(1), COLOURS[0]];
    const mine = new Set(Object.values(world.players).map((p) => p.colour));
    const held = new Set([...away.values()].map((a) => a.colour)); // a returning player keeps theirs
    return order.find((c) => !mine.has(c) && !held.has(c)) ?? order.find((c) => !mine.has(c)) ?? order[0];
  }

  function welcome(conn, p) {
    return { type: "welcome", id: p.id, token: p.token, tick: world.tick, t: world.t, colour: world.players[p.id].colour };
  }

  function join(conn, id, tok, nonce) {
    const p = { id, token: tok, nonce, pending: new Map(), lastInput: null, ack: world.tick, newest: world.tick };
    conns.set(conn, p);
    return p;
  }

  function hello(conn, msg) {
    if (!isObject(msg) || msg.v !== PROTOCOL) return { type: "version" };
    if (conns.has(conn)) return welcome(conn, conns.get(conn));
    const nonce = typeof msg.nonce === "string" && msg.nonce ? msg.nonce : null;
    const holder = typeof msg.token === "string" ? [...conns].find(([, p]) => p.token === msg.token) : null;
    // The same page on a new socket (a network change, a laptop waking) while its old socket is not yet
    // noticed dead: it takes its body back, and the server closes the old one. Another tab with the same
    // token has its own nonce and gets a new player.
    if (holder && nonce && holder[1].nonce === nonce) {
      conns.delete(holder[0]);
      return { ...welcome(conn, join(conn, holder[1].id, msg.token, nonce)), replaced: holder[0] };
    }
    if (conns.size >= NET.maxPlayers) return { type: "full" };
    world ||= createWorld(tuning, { solo: false });
    const back = typeof msg.token === "string" && !holder ? away.get(msg.token) : null;
    if (back) {
      away.delete(msg.token);
      world.scores[back.id] = back.score;
      const e = addPlayer(world, back.id, { name: back.name, colour: back.colour });
      e.shots = back.shots; // shot ids are id.shots.k and must never repeat for one player
      return welcome(conn, join(conn, back.id, msg.token, nonce));
    }
    const id = "p" + nextId++;
    const name = cleanName(msg.name, Object.values(world.players).map((p) => p.name));
    addPlayer(world, id, { name, colour: colourFor() });
    return welcome(conn, join(conn, id, token(), nonce));
  }

  function input(conn, raw) {
    const p = conns.get(conn);
    if (!p || !world || !isObject(raw)) return;
    const clean = cleanInput({ ...(isObject(raw.input) ? raw.input : {}), tick: raw.tick, view: raw.view });
    if (!clean) return;
    if (clean.tick < p.ack - NET.maxAhead || clean.tick > world.tick + NET.maxAhead) return;
    p.pending.set(clean.tick, clean);
    p.newest = clean.tick; // one socket delivers in order; a client that restarted its clock lower is believed
  }

  function drop(conn) {
    const p = conns.get(conn);
    if (!p) return;
    conns.delete(conn);
    const e = world.entities[p.id], pl = world.players[p.id];
    away.set(p.token, { id: p.id, name: pl.name, colour: pl.colour, score: world.scores[p.id], shots: e.shots, until: world.tick + rejoinTicks });
    removePlayer(world, p.id, { keepScore: true });
  }

  // This tick's input for one player: the real ones that have arrived (late ones merged in so a press or
  // turn is never lost), else the held keys for a while, else nothing.
  function inputFor(p, cur) {
    const taken = [...p.pending.keys()].filter((t) => t <= cur).sort((a, b) => a - b).map((t) => {
      const c = p.pending.get(t);
      p.pending.delete(t);
      return c;
    });
    if (taken.length) {
      const main = taken[taken.length - 1];
      let weapon = main.weapon, yawDelta = 0, pitchDelta = 0, jump = false;
      for (const c of taken) {
        jump ||= c.jump;
        yawDelta += c.yawDelta;
        pitchDelta += c.pitchDelta;
      }
      for (let i = taken.length - 2; i >= 0 && !weapon; i--) weapon = taken[i].weapon;
      p.lastInput = main;
      p.ack = Math.max(p.ack, main.tick);
      const lag = clamp((main.tick - main.view) * TICK, 0, NET.maxLag);
      const { tick, view, ...fields } = main;
      return { ...fields, jump, weapon, yawDelta, pitchDelta, lag };
    }
    const last = p.lastInput;
    if (!last || cur - last.tick > NET.hold) return NO_INPUT;
    return {
      ...NO_INPUT, move: last.move, boost: last.boost, fire: last.fire, hook: last.hook, zoom: last.zoom,
      lag: clamp((last.tick - last.view) * TICK, 0, NET.maxLag),
    };
  }

  function step() {
    if (!world) return [];
    const inputs = {};
    for (const p of conns.values()) inputs[p.id] = inputFor(p, world.tick + 1);
    stepWorld(world, inputs, TICK);
    const out = [];
    if (conns.size && world.tick % NET.snapEvery === 0) {
      for (const [conn, p] of conns) {
        out.push({ conn, msg: snapshot(world, { ack: p.ack, slack: p.newest - world.tick, events: world.events }) });
      }
    }
    // Every message carries the events since the last snapshot; with nobody to tell they would only pile up.
    if (!conns.size || out.length) world.events = [];
    for (const [tok, a] of away) {
      if (world.tick < a.until) continue;
      away.delete(tok);
      delete world.scores[a.id];
    }
    if (!conns.size && !away.size) {
      world = null;
      nextId = 1;
    }
    return out;
  }

  return { hello, input, drop, step, get world() { return world; }, players: () => conns.size };
}
