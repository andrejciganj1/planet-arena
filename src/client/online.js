// The browser's side of an online game. It owns the view world the screen draws (cosmetic: it never
// decides a hit), your own player predicted ahead, everyone else drawn between snapshots in the past, and
// the clock that keeps your inputs arriving at the server just before the ticks they belong to.
import { createWorld } from "../sim/world.js";
import { createEntity } from "../sim/entity.js";
import { refreshCues } from "../sim/pads.js";
import { stepProjectiles } from "../sim/weapons.js";
import { placeRec } from "../sim/lag.js";
import { PROTOCOL, applyEntity } from "../net/protocol.js";
import { createPrediction } from "../net/predict.js";
import { createInterp } from "../net/interp.js";
import { NET } from "../tuning.js";
import { connect } from "./net.js";

const ZERO = [0, 0, 0];
const NAME = "planet-arena-name", TOKEN = "planet-arena-token";
// Your shots' beams and blasts are remembered this long (s): far longer than the server takes to echo them.
const FORGET = 5;
// A hidden tab draws no frames, so nobody reads its events; only the newest are kept.
const EVENTS_KEPT = 200;

// Storage can be missing or blocked (private windows, Node): then nothing is remembered.
const load = (store, key) => {
  try {
    return globalThis[store]?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const save = (store, key, value) => {
  try {
    globalThis[store]?.setItem(key, value);
  } catch {}
};

export const storedName = () => load("localStorage", NAME) ?? "";

// +1 runs an extra tick (inputs reach the server too late), -1 skips one (far ahead), else 0.
export const clockNudge = (slack) => (slack < NET.slack[0] ? 1 : slack > NET.slack[1] ? -1 : 0);

export function createOnlineGame(tuning, url, name, connectFn = connect) {
  const { TICK, MAX_TICKS } = tuning;
  const view = createWorld(tuning, { solo: false });
  view.cosmetic = true;
  let id = null, pred = null, interp = null, token = load("sessionStorage", TOKEN);
  let status = "connecting", outcome = null; // outcome: null, "full" or "version"
  let acc = 0, nudge = 0, nudgedAt = -Infinity;
  // Which page a hello comes from, so this page's new socket can take its player back from an old socket
  // the server has not yet noticed dead. In memory only: a duplicated tab copies the token from session
  // storage but has its own nonce, and so gets a player of its own.
  const nonce = [...crypto.getRandomValues(new Uint32Array(2))].map((x) => x.toString(16).padStart(8, "0")).join("");
  let own = []; // your shots, flown here; everyone else's are drawn from the snapshots
  const drawn = new Map(); // shot id -> when seen, for beams and blasts already on screen
  // The server's beams and blasts wait here for the next frame, with the server time they began. Only ticks
  // age what is on screen, and a hidden tab runs none, so until then they are aged and dropped by the
  // snapshots' clock instead.
  let heard = [], newest = 0; // newest: the latest snapshot's t
  const showFor = { beams: tuning.WEAPONS.railgun.showFor, explosions: tuning.ROCKET.showFor };
  save("localStorage", NAME, name);

  // As in the prediction: the clock is built by adding TICK, so it matches the server's floats.
  const after = (t, n) => {
    for (let i = 0; i < n; i++) t += TICK;
    return t;
  };

  // Every welcome starts over, whether a first join, a reconnect or a restarted server whose clock went back.
  function welcome(msg) {
    id = msg.id;
    token = msg.token;
    save("sessionStorage", TOKEN, token);
    outcome = null;
    Object.assign(view, { selfId: id, entities: {}, projectiles: [], beams: [], explosions: [], players: {}, scores: {}, pickups: {}, cues: {} });
    own = [];
    heard = [];
    drawn.clear();
    acc = nudge = 0;
    nudgedAt = -Infinity;
    interp = createInterp(view.system);
    pred = createPrediction(view, id);
    pred.start(msg.tick + NET.lead, after(msg.t, NET.lead));
  }

  function snap(msg) {
    if (!pred) return;
    interp.push(msg);
    const before = view.tick;
    pred.reconcile(msg);
    if (view.tick < before) nudgedAt = -Infinity; // the clock restarted lower: the old mark would block nudges
    // One tick faster or slower per snapshot, but only once the server has inputs sent since the last
    // change; reacting again before that would overshoot by a round trip's worth of ticks.
    if (msg.tick + msg.slack >= nudgedAt) {
      nudge = clockNudge(msg.slack);
      if (nudge) nudgedAt = view.tick + 1;
    }
    for (const [pid, readyAt] of Object.entries(msg.pickups)) view.pickups[pid] = { readyAt };
    view.players = {};
    view.scores = {};
    for (const [pid, p] of Object.entries(msg.players)) {
      view.players[pid] = { name: p.name, colour: p.colour };
      view.scores[pid] = { kills: p.kills, deaths: p.deaths };
    }
    // A beam is in every snapshot while it shows: drawn once, then aged here.
    for (const b of msg.beams) {
      if (drawn.has(b.id)) continue;
      drawn.set(b.id, msg.t);
      heard.push({ list: "beams", item: b, at: msg.t - b.age });
    }
    for (const ev of msg.events) {
      if (ev.type === "explode" && drawn.has(ev.id)) continue; // your own rocket, drawn when it hit here
      if (ev.type === "explode" || (ev.type === "death" && ev.cause !== "void")) heard.push({ list: "explosions", item: { pos: ev.pos, age: 0 }, at: msg.t });
      view.events.push(ev);
    }
    if (view.events.length > EVENTS_KEPT) view.events.splice(0, view.events.length - EVENTS_KEPT);
    heard = heard.filter((h) => msg.t - h.at < showFor[h.list]);
    newest = msg.t;
    for (const [k, t] of drawn) if (t < msg.t - FORGET) drawn.delete(k);
  }

  let conn = null;
  conn = connectFn(url, {
    hello: () => ({ type: "hello", v: PROTOCOL, name, nonce, ...(token ? { token } : {}) }),
    onStatus: (s) => (status = s),
    onMessage(msg) {
      if (msg?.type === "welcome") welcome(msg);
      else if (msg?.type === "snap") snap(msg);
      else if (msg?.type === "full") outcome = "full"; // the connection keeps trying: a seat may free up
      else if (msg?.type === "version") {
        outcome = "version";
        conn?.close();
      }
    },
  });

  // One client tick: your player predicted with one input, which goes to the server stamped with the
  // tick it belongs to and the tick you see the others at; then your shots fly.
  function tick(input) {
    view.projectiles = own;
    const from = view.events.length;
    pred.step(input);
    stepProjectiles(view, TICK);
    own = view.projectiles;
    for (const b of view.beams) if (b.mine && !drawn.has(b.id)) drawn.set(b.id, view.t);
    for (const ev of view.events.slice(from)) if (ev.type === "explode" && ev.id) drawn.set(ev.id, view.t);
    conn.send({ type: "input", tick: view.tick, view: Math.round(interp.view()), input });
  }

  // Runs ticks for real elapsed time (as sim's advance does), then fills the view for drawing. `take`
  // gives the input for each tick.
  function frame(elapsed, take) {
    if (!pred) return;
    for (const h of heard) {
      h.item.age = newest - h.at;
      view[h.list].push(h.item);
    }
    heard = [];
    acc += elapsed;
    let n = Math.floor(acc / TICK + 1e-9);
    if (n > MAX_TICKS) {
      n = MAX_TICKS;
      acc = n * TICK;
    }
    acc = Math.max(0, acc - n * TICK);
    n += nudge;
    nudge = Math.min(0, n); // a skip on a frame with no tick waits for the next one
    for (let i = 0; i < n; i++) tick(take());

    // Everyone else as seen a little in the past; those standing ride their body at the view's own
    // time, between the last two ticks like the planets are drawn.
    const seen = interp.sample(interp.advance(elapsed));
    for (const [eid, rec] of Object.entries(seen.entities)) {
      if (eid === id) continue;
      const e = (view.entities[eid] ||= createEntity(eid, rec.kind, ZERO, [0, 1, 0]));
      applyEntity(e, rec); // decodes into e, leaving the sampled record as interp keeps it
      e.prev = { pos: placeRec(e, view.prevPoses), up: e.up };
      e.pos = placeRec(e, view.poses);
    }
    for (const eid of Object.keys(view.entities)) if (eid !== id && !seen.entities[eid]) delete view.entities[eid];
    view.projectiles = own.concat(seen.shots.filter((s) => s.owner !== id));
    refreshCues(view);
  }

  return {
    world: view,
    frame,
    offset: () => (pred ? pred.offset() : ZERO),
    close: () => conn.close(),
    get id() { return id; },
    get me() { return pred?.me; },
    get status() { return status; },
    get outcome() { return outcome; },
    get alpha() { return Math.min(1, acc / TICK); },
  };
}
