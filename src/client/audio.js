// The mixer: plays the director's sounds through one AudioContext, made on the first click (browsers allow
// sound only after one). Other players' sounds come from where they are (an HRTF panner each, quieter with
// distance, cut beyond SOUND.range). A limiter keeps bursts from stacking into a roar. Any Web Audio failure
// turns sound off for good instead of reaching the game.
import { SOUND } from "../tuning.js";
import { dist } from "../sim/vec.js";
import { RECIPES, LOOPS } from "./synth.js";

export const audible = (d) => d <= SOUND.range;

// Loops skip the limiter (they hold, they don't burst), so a swarm of rockets is capped here instead: the
// SOUND.maxLoops nearest the listener; one in your head (pos null) is nearest of all.
export function nearest(want, ear, max = SOUND.maxLoops) {
  if (want.size <= max) return want;
  const d = (s) => (s.pos ? dist(s.pos, ear) : -1);
  return new Map([...want].sort((a, b) => d(a[1]) - d(b[1])).slice(0, max));
}

// The limiter's memory: when each playing voice ends, and when each name last played.
export const limiter = () => ({ ends: [], last: new Map() });

// Whether a one-shot may play now: at most SOUND.maxVoices at once, and one name not again within
// SOUND.repeat s (a minigun burst or a chain of blasts stays a rhythm, not a roar). An admitted voice counts
// for SOUND.voice s until play() learns its real end.
export function admit(state, name, now) {
  state.ends = state.ends.filter((e) => e > now);
  if (state.ends.length >= SOUND.maxVoices) return false;
  const last = state.last.get(name);
  if (last !== undefined && now - last < SOUND.repeat) return false;
  state.last.set(name, now);
  state.ends.push(now + SOUND.voice);
  return true;
}

function place(panner, [x, y, z]) {
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else panner.setPosition(x, y, z);
}

export function createAudio({ AudioContextImpl = globalThis.AudioContext } = {}) {
  let ctx = null, master = null, dead = false, enabled = true;
  let ear = [0, 0, 0];
  const lim = limiter();
  const loops = new Map(); // key -> { name, panner, nodes, handle }

  const guard = (f) => (...args) => {
    if (dead) return;
    try {
      f(...args);
    } catch (e) {
      dead = true;
      console.warn("sound is off:", e?.message);
    }
  };
  const live = () => ctx && enabled && ctx.state === "running";
  const later = (secs, f) => setTimeout(() => {
    try {
      f();
    } catch {
      // already gone
    }
  }, secs * 1000);

  // A sound's own gain, then its panner if it has a place.
  function voice(sound) {
    const g = ctx.createGain();
    g.gain.value = (sound.own ? SOUND.own : SOUND.others) * (sound.gain ?? 1);
    if (!sound.pos) {
      g.connect(master);
      return { input: g, panner: null, nodes: [g] };
    }
    const p = ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = SOUND.near;
    p.maxDistance = SOUND.range;
    p.rolloffFactor = 1;
    place(p, sound.pos);
    g.connect(p);
    p.connect(master);
    return { input: g, panner: p, nodes: [g, p] };
  }
  const far = (sound) => sound.pos && !audible(dist(sound.pos, ear));
  const release = (nodes, secs) => later(secs, () => nodes.forEach((n) => n.disconnect()));

  function stopLoop(key) {
    const l = loops.get(key);
    loops.delete(key);
    l.handle.stop();
    release(l.nodes, 0.3);
  }

  return {
    // On every click that should start sound: makes the context the first time, wakes it after.
    unlock: guard(() => {
      if (!ctx) {
        ctx = new AudioContextImpl();
        if (ctx.state !== "running") ctx.resume()?.catch?.(() => {});
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 6;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.15;
        master = ctx.createGain();
        master.gain.value = enabled ? SOUND.master : 0;
        master.connect(comp);
        comp.connect(ctx.destination);
      } else if (ctx.state !== "running") ctx.resume()?.catch?.(() => {});
    }),
    // The camera: where you hear from and which way is front and up.
    setListener: guard((pos, forward, up) => {
      ear = pos;
      if (!ctx) return;
      const l = ctx.listener;
      if (l.positionX) {
        [l.positionX, l.positionY, l.positionZ].forEach((p, k) => (p.value = pos[k]));
        [l.forwardX, l.forwardY, l.forwardZ].forEach((p, k) => (p.value = forward[k]));
        [l.upX, l.upY, l.upZ].forEach((p, k) => (p.value = up[k]));
      } else {
        l.setPosition(...pos);
        l.setOrientation(...forward, ...up);
      }
    }),
    // A one-shot: { name, pos | null, own, gain? }. A suspended context would queue it for a burst later,
    // so nothing plays until it runs.
    play: guard((sound) => {
      if (!live() || LOOPS.has(sound.name) || !RECIPES[sound.name] || far(sound)) return;
      const now = ctx.currentTime;
      if (!admit(lim, sound.name, now)) return;
      const v = voice(sound);
      const end = RECIPES[sound.name](ctx, v.input)?.end ?? now + SOUND.voice;
      lim.ends[lim.ends.length - 1] = end; // admit just pushed this voice's provisional end
      release(v.nodes, end - now + 0.2);
    }),
    // The loops that should sound now, keyed per instance: new ones start, gone ones fade, the rest move.
    setLoops: guard((all) => {
      if (!ctx) return;
      const on = live(), want = nearest(all, ear);
      for (const [key, l] of loops) {
        const s = want.get(key);
        if (!on || !s || s.name !== l.name || far(s)) stopLoop(key);
        else if (s.pos && l.panner) place(l.panner, s.pos);
      }
      if (!on) return;
      for (const [key, s] of want) {
        if (loops.has(key) || !LOOPS.has(s.name) || far(s)) continue;
        const v = voice(s);
        loops.set(key, { name: s.name, panner: v.panner, nodes: v.nodes, handle: RECIPES[s.name](ctx, v.input) });
      }
    }),
    // For the page check: "waiting" before the first click, then the context's state, "disabled" once Web
    // Audio failed or is missing.
    state: () => (dead ? "disabled" : ctx ? ctx.state : "waiting"),
    // M: off fades everything out and stops the loops; the next setLoops starts them again.
    setEnabled: guard((on) => {
      enabled = on;
      if (!master) return;
      master.gain.setTargetAtTime(on ? SOUND.master : 0, ctx.currentTime, 0.02);
      if (!on) for (const key of [...loops.keys()]) stopLoop(key);
    }),
  };
}
