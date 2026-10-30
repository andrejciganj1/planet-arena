// How each sound is made: Web Audio oscillators, noise, filters and envelopes, our own recipes in the spirit
// of Quake 3 (short and punchy), copied from no game; only the two voices are files. A recipe builds its
// sound now into `out` and returns { end } (the context time it falls silent) or, for a loop, { stop }.
// Nothing touches Web Audio until a recipe is called, so node tests can load this.

// The loops: they sound until stopped, the rest are one-shots of at most 1.5 s (the scream 2.5 s).
export const LOOPS = new Set(["rocketFlight", "rockIncoming", "hookPull", "boost", "sizzle"]);

const SILENT = 0.0003; // -70 dB: where an envelope ends, well below what anyone hears in a game
const noiseBuffers = new WeakMap();

// Two seconds of white noise per context, looped from a random point so no two shots sound alike.
function noise(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  return s;
}

const rand = (a, b) => a + Math.random() * (b - a);

// filter: [type, freq, q, freqEnd?]; a freqEnd sweeps the filter over the layer.
function filtered(ctx, src, filter, t, dur) {
  if (!filter) return src;
  const [type, f, q = 1, f1] = filter;
  const n = ctx.createBiquadFilter();
  n.type = type;
  n.Q.value = q;
  n.frequency.setValueAtTime(f, t);
  if (f1) n.frequency.exponentialRampToValueAtTime(f1, t + dur);
  src.connect(n);
  return n;
}

// The envelope every one-shot layer shares: up to `peak` in `a` s, then an exponential fall to silence over
// `d` s, which sounds natural and ends cleanly. Returns when the layer is silent.
function envelope(ctx, node, out, t, { peak, a = 0.002, d }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(SILENT, t + a + d);
  node.connect(g);
  g.connect(out);
  return t + a + d;
}

// A burst of filtered noise starting `at` s from t0.
function hiss(ctx, out, t0, o) {
  const t = t0 + (o.at || 0), s = noise(ctx);
  const end = envelope(ctx, filtered(ctx, s, o.filter, t, (o.a || 0.002) + o.d), out, t, o);
  s.start(t, rand(0, 1.5));
  s.stop(end + 0.02);
  return end;
}

// A tone gliding from f to f1 over `glide` s (default the whole layer). vib: [rate Hz, cents, cents at the
// end] wobbles the pitch, which is what makes the boink springy and the death sound cartoonish.
function tone(ctx, out, t0, o) {
  const t = t0 + (o.at || 0), s = ctx.createOscillator(), dur = (o.a || 0.002) + o.d;
  s.type = o.wave || "sine";
  s.frequency.setValueAtTime(o.f, t);
  if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || dur));
  const extra = [];
  if (o.vib) {
    const [rate, cents, centsEnd = cents] = o.vib;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = rate;
    depth.gain.setValueAtTime(cents, t);
    if (centsEnd !== cents) depth.gain.exponentialRampToValueAtTime(centsEnd, t + dur);
    lfo.connect(depth);
    depth.connect(s.detune);
    extra.push(lfo);
  }
  const end = envelope(ctx, filtered(ctx, s, o.filter, t, dur), out, t, o);
  for (const n of [s, ...extra]) {
    n.start(t);
    n.stop(end + 0.02);
  }
  return end;
}

// The voices, the only sounds from files (assets/sun-kill.wav, assets/scream.wav and assets/flare-warning.wav,
// made with Piper, see README). The bytes are fetched as the page loads, so the first call needn't wait for the network; only in a
// browser, since node tests load this file too. Decoding needs a context, so it waits for the first one; the
// decoded buffer then serves every context.
const fetched = (file) => (typeof document === "undefined" ? null
  : fetch(new URL(`../../assets/${file}`, import.meta.url))
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null));

// load(ctx) resolves once the clip can play, or once it is clear it can't (then it stays silent). A failure
// isn't remembered: the next call (the engine asks on every unlock) tries again, so one bad moment doesn't
// silence it for the session. `bytes` is for tests.
export function voiceClip(what, bytes) {
  let buf = null, decoding = null;
  return {
    buffer: () => buf,
    load(ctx) {
      if (buf) return Promise.resolve();
      decoding ??= Promise.resolve(bytes)
        .then((b) => b && ctx.decodeAudioData(b.slice(0))) // decoding detaches what it is given; keep ours for a retry
        .then((decoded) => {
          buf = decoded || null;
          if (!buf) decoding = null;
        })
        .catch((e) => {
          decoding = null;
          console.warn(`the ${what} is silent:`, e?.message);
        });
      return decoding;
    },
  };
}

export const VOICE_FILES = ["sun-kill.wav", "scream.wav", "flare-warning.wav"];
const sunKill = voiceClip("announcer", fetched("sun-kill.wav"));
const nooo = voiceClip("scream", fetched("scream.wav"));
const flareWarning = voiceClip("flare warning", fetched("flare-warning.wav"));
export const loadVoice = (ctx) => Promise.all([sunKill.load(ctx), nooo.load(ctx), flareWarning.load(ctx)]);

// Plays a clip now if decoded; else as soon as it is, unless that is too late to still belong to the moment.
// Returns when it ends, or a guess while it waits.
function voiced(ctx, out, clip, play, guess) {
  const t = ctx.currentTime;
  if (clip.buffer()) return play(ctx, out, t, clip.buffer());
  clip.load(ctx)
    .then(() => clip.buffer() && ctx.currentTime < t + 0.25 && play(ctx, out, ctx.currentTime, clip.buffer()))
    .catch(() => {}); // the context closed meanwhile: nothing to play into
  return { end: t + guess };
}

// Lower than recorded (a bigger, more cartoonish announcer), then a few late, darker copies: a big hall
// answering. The echoes are ours, so the file stays a plain voice.
const SAY = { rate: 0.85, dry: 0.7 };
const ECHO = [[0.12, 0.32, 2400], [0.25, 0.18, 1600], [0.38, 0.09, 1100]]; // [delay s, gain, lowpass Hz]

function say(ctx, out, t, line) {
  const src = ctx.createBufferSource();
  src.buffer = line;
  src.playbackRate.value = SAY.rate;
  const dry = ctx.createGain();
  dry.gain.value = SAY.dry;
  src.connect(dry);
  dry.connect(out);
  const len = line.duration / SAY.rate;
  for (const [delay, gain, cutoff] of ECHO) {
    const d = ctx.createDelay(1);
    d.delayTime.value = delay;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(d);
    d.connect(f);
    f.connect(g);
    g.connect(out);
  }
  src.start(t);
  return { end: t + len + ECHO[ECHO.length - 1][0] };
}

// The scream: a small creature, not a sped-up man. The file is one short "No!"; its "o" is held by looping
// three pitch periods from its steadiest stretch, so the vowel stays one even "ooo" (a string of o's from the
// speech tool dips between syllables: "nowowowo"). Played higher than recorded, which raises the voice's
// formants with its pitch (what makes it small), with a slow, shallow vibrato. At `release` s the rest of the
// file takes over and the pitch, level and brightness sag together as the alien drifts away; one late, dark
// echo. loop: [start, end] s in the file, at upward zero crossings in the vowel's steadiest stretch, where the
// period after each matches the other. rate: the playback rate held; to: where the sag ends.
export const CRY = {
  loop: [0.3439, 0.37102], rate: 1.8, release: 1.45, sag: 0.45, to: 1.1, vib: [5, 12], fade: 0.03,
  dry: 0.55, far: 0.3, echo: [0.16, 0.18, 2000],
};

// When the held vowel starts and when the release takes over, in s from the start. The release waits for a
// loop boundary, so the rest of the file starts in step with the held loop and the handover can't dip.
export function cryHeld({ loop: [a, b], rate, release } = CRY) {
  const first = b / rate, period = (b - a) / rate;
  return { from: a / rate, to: first + Math.max(0, Math.round((release - first) / period)) * period };
}

function cry(ctx, out, t, clip) {
  const { loop: [a, b], rate, sag, to, vib: [hz, cents], fade, dry, far, echo: [delay, gain, cutoff] } = CRY;
  const tr = t + cryHeld().to, end = tr + sag;
  const held = ctx.createBufferSource(), rest = ctx.createBufferSource();
  held.buffer = rest.buffer = clip;
  held.loop = true;
  held.loopStart = a;
  held.loopEnd = b;
  held.playbackRate.value = rate;
  rest.playbackRate.setValueAtTime(rate, tr);
  rest.playbackRate.exponentialRampToValueAtTime(to, end);
  // The vibrato runs whole cycles up to the handover, so it has moved the loop neither ahead nor behind there.
  const lfo = ctx.createOscillator(), depth = ctx.createGain();
  lfo.frequency.value = Math.max(1, Math.round(hz * (tr - t))) / (tr - t);
  depth.gain.value = cents;
  lfo.connect(depth);
  depth.connect(held.detune);
  depth.connect(rest.detune);
  const heldGain = ctx.createGain(), restGain = ctx.createGain();
  heldGain.gain.setValueAtTime(1, tr);
  heldGain.gain.linearRampToValueAtTime(0, tr + fade);
  restGain.gain.setValueAtTime(0, tr);
  restGain.gain.linearRampToValueAtTime(1, tr + fade);
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  // A param holds its default until its first event, so each is set from t too, not only from the sag.
  tone.frequency.setValueAtTime(9000, t);
  tone.frequency.setValueAtTime(9000, tr);
  tone.frequency.exponentialRampToValueAtTime(1500, end);
  const g = ctx.createGain();
  g.gain.setValueAtTime(dry, t);
  g.gain.setValueAtTime(dry, tr);
  g.gain.exponentialRampToValueAtTime(dry * far, end);
  held.connect(heldGain);
  rest.connect(restGain);
  heldGain.connect(tone);
  restGain.connect(tone);
  tone.connect(g);
  g.connect(out);
  const d = ctx.createDelay(1), f = ctx.createBiquadFilter(), e = ctx.createGain();
  d.delayTime.value = delay;
  f.type = "lowpass";
  f.frequency.value = cutoff;
  e.gain.value = gain;
  g.connect(d);
  d.connect(f);
  f.connect(e);
  e.connect(out);
  held.start(t);
  held.stop(tr + fade + 0.01);
  rest.start(tr, b);
  lfo.start(t);
  lfo.stop(end + 0.3);
  // The rest of the file plays out at about `to` after the sag.
  return { end: end + Math.max(0, clip.duration - b - sag * (rate - to) / Math.log(rate / to)) / to + delay };
}

// A one-shot from layers: [hiss or tone, options] each. Returns { end }.
function shot(ctx, out, layers) {
  const t = ctx.currentTime;
  let end = t;
  for (const [kind, o] of layers) end = Math.max(end, kind(ctx, out, t, o));
  return { end };
}

// Holds a param where it is now, so a fade starts from the current level.
function hold(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

// A loop: build(into, t) makes and starts its sources into a gain that fades in, and stop() fades it out,
// so starting and stopping never click.
function looped(ctx, out, build) {
  const t = ctx.currentTime, g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + 0.06);
  g.connect(out);
  const sources = build(g, t);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const n = ctx.currentTime;
      hold(g.gain, n);
      g.gain.linearRampToValueAtTime(0, n + 0.1);
      for (const s of sources) s.stop(n + 0.12);
    },
  };
}

// A looping source through a filter at a fixed level, started now (noise from a random point).
function bed(ctx, into, t, src, filter, level) {
  const g = ctx.createGain();
  g.gain.value = level;
  filtered(ctx, src, filter, t, 0).connect(g);
  g.connect(into);
  src.start(t, src.buffer ? rand(0, 1.5) : undefined);
  return src;
}

// An LFO adding `depth` times a sine of `rate` Hz to a param.
function wobble(ctx, param, t, rate, depth, wave = "sine") {
  const lfo = ctx.createOscillator(), g = ctx.createGain();
  lfo.type = wave;
  lfo.frequency.value = rate;
  g.gain.value = depth;
  lfo.connect(g);
  g.connect(param);
  lfo.start(t);
  return lfo;
}

export const RECIPES = {
  // A bright noise crack over a square that drops in pitch: a small, dry pop.
  pistol: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", rand(2400, 2800), 0.9], peak: 0.55, d: 0.06 }],
    [tone, { wave: "square", f: 420, f1: 120, filter: ["lowpass", 1800], peak: 0.3, d: 0.16 }],
    [tone, { f: 160, f1: 60, peak: 0.22, a: 0.002, d: 0.08 }],
  ]),
  // A wide noise blast with a low punch, then a quiet two-tick pump so it reads as a shotgun.
  shotgun: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["lowpass", 4000, 0.7, 700], peak: 0.45, a: 0.003, d: 0.3 }],
    [hiss, { filter: ["highpass", 3000], peak: 0.22, d: 0.03 }],
    [tone, { f: 130, f1: 45, peak: 0.35, a: 0.003, d: 0.22 }],
    [hiss, { at: 0.42, filter: ["bandpass", 2200, 3], peak: 0.25, d: 0.025 }],
    [hiss, { at: 0.5, filter: ["bandpass", 1500, 3], peak: 0.25, d: 0.035 }],
  ]),
  // A deep thump and a rising whoosh as the rocket leaves the tube.
  rocket: (ctx, out) => shot(ctx, out, [
    [tone, { f: 110, f1: 38, peak: 0.7, a: 0.004, d: 0.35 }],
    [hiss, { filter: ["lowpass", 400, 1, 2200], peak: 0.3, a: 0.04, d: 0.4 }],
  ]),
  // Very short and a little different each shot (filter and pitch), so a long burst doesn't grate.
  minigun: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", rand(1450, 2050), 1.2], peak: 0.5, d: 0.045 }],
    [tone, { wave: "square", f: rand(170, 210), f1: 110, filter: ["lowpass", 1500], peak: 0.16, d: 0.05 }],
  ]),
  // A sharp high crack, a short body and a long, low rolling tail: a rifle heard across a valley.
  sniper: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["highpass", 2500], peak: 0.45, a: 0.0005, d: 0.035 }],
    [hiss, { filter: ["bandpass", 1100, 1.5], peak: 0.4, d: 0.12 }],
    [tone, { wave: "triangle", f: 900, f1: 300, peak: 0.2, d: 0.08 }],
    [hiss, { filter: ["lowpass", 900, 0.7, 300], peak: 0.25, a: 0.02, d: 0.7 }],
  ]),
  // A charge rising in 0.11 s, then a buzzing zap falling with a sizzle: charged, electric, unlike any gun.
  railgun: (ctx, out) => shot(ctx, out, [
    [tone, { wave: "sawtooth", f: 160, f1: 1400, glide: 0.11, filter: ["lowpass", 3000], peak: 0.2, a: 0.1, d: 0.05 }],
    [tone, { at: 0.11, wave: "sawtooth", f: 1600, f1: 90, vib: [38, 300], filter: ["lowpass", 4000, 1, 600], peak: 0.3, d: 0.5 }],
    [hiss, { at: 0.11, filter: ["bandpass", 5000, 1], peak: 0.25, d: 0.4 }],
    [tone, { at: 0.11, f: 80, f1: 40, peak: 0.4, d: 0.2 }],
  ]),
  // A rocket in flight: a breathy hiss with a flutter over a low rumble.
  rocketFlight: (ctx, out) => looped(ctx, out, (g, t) => {
    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    flutter.connect(g);
    return [
      bed(ctx, flutter, t, noise(ctx), ["bandpass", 900, 0.8], 0.5),
      bed(ctx, g, t, noise(ctx), ["lowpass", 250], 0.5),
      wobble(ctx, flutter.gain, t, 7, 0.25),
    ];
  }),
  // A noise burst whose brightness falls away, over a low body: the blast and its boom.
  explode: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["lowpass", 5000, 0.7, 250], peak: 0.36, a: 0.003, d: 1.1 }],
    [hiss, { filter: ["highpass", 2000], peak: 0.15, d: 0.25 }],
    [tone, { f: 75, f1: 28, glide: 0.6, peak: 0.4, a: 0.015, d: 0.75 }],
  ]),
  // A rock coming: a low roar whose filter churns, with a faint high whistle to pick it out of the din.
  rockIncoming: (ctx, out) => looped(ctx, out, (g, t) => {
    const roar = ctx.createBiquadFilter();
    roar.type = "bandpass";
    roar.frequency.value = 520;
    roar.Q.value = 3;
    const level = ctx.createGain();
    level.gain.value = 1.2;
    const n = noise(ctx);
    n.connect(roar);
    roar.connect(level);
    level.connect(g);
    n.start(t, rand(0, 1.5));
    const whistle = ctx.createOscillator();
    whistle.frequency.value = 700;
    return [
      n,
      wobble(ctx, roar.frequency, t, 3, 140),
      bed(ctx, g, t, noise(ctx), ["lowpass", 180, 1], 0.6),
      bed(ctx, g, t, whistle, null, 0.05),
      wobble(ctx, whistle.frequency, t, 5, 12),
    ];
  }),
  // A rock dying in the sun: a fizzle and a soft whump, not a blast.
  rockBurn: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", 3500, 0.7, 1500], peak: 0.35, a: 0.02, d: 0.9 }],
    [hiss, { filter: ["lowpass", 400], peak: 0.35, a: 0.01, d: 0.4 }],
    [tone, { f: 300, f1: 80, peak: 0.12, a: 0.02, d: 0.6 }],
  ]),
  // Your hit: one short, bright bell strike (an inharmonic partner gives it the ping), quiet enough to
  // hear a hundred times.
  ding: (ctx, out) => shot(ctx, out, [
    [tone, { f: 1320, peak: 0.35, a: 0.002, d: 0.22 }],
    [tone, { f: 1980, peak: 0.1, d: 0.15 }],
    [tone, { f: 3643, peak: 0.08, d: 0.06 }],
  ]),
  // An "oof": a buzzy falling tone through a vowel-like band, with a thud; pitch varies a little.
  hurt: (ctx, out) => {
    const k = rand(0.9, 1.1);
    return shot(ctx, out, [
      [tone, { wave: "sawtooth", f: 210 * k, f1: 120 * k, filter: ["bandpass", 700, 2], peak: 0.9, a: 0.01, d: 0.18 }],
      [hiss, { filter: ["lowpass", 500], peak: 0.35, d: 0.08 }],
    ]);
  },
  // A cartoon fall: a wobbling tone sliding down, over a thump.
  death: (ctx, out) => shot(ctx, out, [
    [tone, { wave: "sawtooth", f: 380, f1: 55, vib: [7, 60], filter: ["lowpass", 1400], peak: 0.4, a: 0.01, d: 0.9 }],
    [tone, { f: 90, f1: 35, peak: 0.5, a: 0.003, d: 0.3 }],
  ]),
  // "Nooo!": lost in space, the alien screams as it drifts away (see cry).
  scream: (ctx, out) => voiced(ctx, out, nooo, cry, 2.2),
  // "Sun kill!": the recorded line, deeper and with an arena echo. The first call may come before the file
  // is decoded; it then plays as soon as it is, unless that is too late to still belong to the kill.
  announcer: (ctx, out) => voiced(ctx, out, sunKill, say, 1.5),
  // A klaxon: two tones swapping, four times, buzzy but filtered so it alarms without hurting.
  flareAlarm: (ctx, out) => shot(ctx, out, [0, 1, 2, 3].flatMap((k) => [
    [tone, { at: k * 0.3, wave: "sawtooth", f: k % 2 ? 587 : 784, filter: ["lowpass", 2400], peak: 0.3, a: 0.01, d: 0.26 }],
    [tone, { at: k * 0.3, wave: "square", f: (k % 2 ? 587 : 784) / 2, filter: ["lowpass", 900], peak: 0.12, a: 0.01, d: 0.26 }],
  ])),
  // "Imminent solar flare detected": the announcer's voice and hall, read from its file like "Sun kill!".
  flareVoice: (ctx, out) => voiced(ctx, out, flareWarning, say, 2.3),
  // The burst: a deep, rolling roar that swells in and slowly darkens, under a high hiss of the light.
  flareRoar: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["lowpass", 900, 0.8, 120], peak: 0.55, a: 0.12, d: 2 }],
    [hiss, { filter: ["highpass", 5000], peak: 0.08, a: 0.05, d: 1.2 }],
    [tone, { f: 52, f1: 30, glide: 1.6, peak: 0.45, a: 0.1, d: 1.8 }],
  ]),
  // Burning: a crackling fry, bright noise whose level jitters fast, over a low hot hum.
  sizzle: (ctx, out) => looped(ctx, out, (g, t) => {
    const crackle = ctx.createGain();
    crackle.gain.value = 0.6;
    crackle.connect(g);
    return [
      bed(ctx, crackle, t, noise(ctx), ["bandpass", 4200, 0.7], 0.35),
      wobble(ctx, crackle.gain, t, 23, 0.4, "square"),
      wobble(ctx, crackle.gain, t, 7.3, 0.2, "square"),
      bed(ctx, g, t, noise(ctx), ["lowpass", 300], 0.25),
    ];
  }),
  // A spring: the pitch leaps up and wobbles fast, the wobble dying away.
  boink: (ctx, out) => shot(ctx, out, [
    [tone, { wave: "triangle", f: 220, f1: 560, glide: 0.12, vib: [16, 300, 1], peak: 0.55, a: 0.005, d: 0.4 }],
    [tone, { f: 110, f1: 280, glide: 0.12, peak: 0.3, a: 0.005, d: 0.25 }],
  ]),
  // Two quick rising notes: got it.
  pickup: (ctx, out) => shot(ctx, out, [
    [tone, { wave: "triangle", f: 880, peak: 0.3, d: 0.07 }],
    [tone, { at: 0.07, wave: "triangle", f: 1320, peak: 0.3, d: 0.18 }],
    [tone, { at: 0.07, f: 2640, peak: 0.06, d: 0.12 }],
  ]),
  // Something is back: a soft, slightly detuned shimmer that swells instead of striking.
  pickupBack: (ctx, out) => shot(ctx, out, [
    [tone, { f: 659, peak: 0.15, a: 0.06, d: 0.55 }],
    [tone, { f: 663, peak: 0.12, a: 0.06, d: 0.55 }],
    [tone, { at: 0.08, f: 988, peak: 0.12, a: 0.06, d: 0.55 }],
    [tone, { at: 0.08, f: 993, peak: 0.1, a: 0.06, d: 0.55 }],
  ]),
  // A soft, low thud, a little different every step so walking doesn't tick like a clock.
  step: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["lowpass", rand(280, 420), 1], peak: 0.25, a: 0.003, d: 0.06 }],
    [tone, { f: rand(72, 88), f1: 50, peak: 0.18, a: 0.003, d: 0.05 }],
  ]),
  // A "thwip": a quick upward sweep of noise and tone, the hook leaving.
  hookFire: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", 900, 2, 3500], peak: 0.5, a: 0.004, d: 0.1 }],
    [hiss, { filter: ["highpass", 4000], peak: 0.25, d: 0.01 }],
    [tone, { wave: "triangle", f: 600, f1: 1400, peak: 0.15, d: 0.08 }],
  ]),
  // The hook biting: a short metallic clank (two inharmonic partials over a click) and a dull knock.
  hookCatch: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", 3200, 2], peak: 0.4, d: 0.02 }],
    [tone, { wave: "triangle", f: 1180, peak: 0.22, a: 0.002, d: 0.2 }],
    [tone, { f: 2870, peak: 0.1, a: 0.002, d: 0.12 }],
    [tone, { f: 140, f1: 90, peak: 0.25, a: 0.003, d: 0.1 }],
  ]),
  // Being reeled in: soft zipper teeth (gently pulsed noise) through a resonance that rises like a bottle
  // filling, the teeth speeding up with it. Kept under the other sounds: a narrow, slow rise that ends low, a
  // lowpass over it and a sine pulse instead of a square, so it never whines. The level falls as the band
  // rises, so the loop stays even.
  hookPull: (ctx, out) => looped(ctx, out, (g, t) => {
    const rise = 1.4, lo = 380, hi = 1300; // s, the time constant of the rise; Hz, where the band starts and ends
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 3;
    band.frequency.setValueAtTime(lo, t);
    band.frequency.setTargetAtTime(hi, t, rise);
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 2200;
    const teeth = ctx.createGain();
    teeth.gain.value = 0.7; // the pulse below swings it 0.4..1
    const even = ctx.createGain();
    even.gain.setValueAtTime(0.65, t);
    even.gain.setTargetAtTime(0.65 * Math.sqrt(lo / hi), t, rise);
    const n = noise(ctx);
    n.connect(teeth);
    teeth.connect(band);
    band.connect(soft);
    soft.connect(even);
    even.connect(g);
    n.start(t, rand(0, 1.5));
    const pulse = wobble(ctx, teeth.gain, t, 18, 0.3);
    pulse.frequency.setTargetAtTime(28, t, rise);
    // The bottle's note, rising with the band, a faint sine.
    const note = ctx.createOscillator();
    note.frequency.setValueAtTime(260, t);
    note.frequency.setTargetAtTime(700, t, rise);
    return [n, pulse, bed(ctx, g, t, note, null, 0.015)];
  }),
  // The booster: a steady breathy jet over a low rumble, with a fast flutter.
  boost: (ctx, out) => looped(ctx, out, (g, t) => {
    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    flutter.connect(g);
    return [
      bed(ctx, flutter, t, noise(ctx), ["bandpass", 1400, 0.6], 0.22),
      bed(ctx, flutter, t, noise(ctx), ["lowpass", 160], 0.4),
      wobble(ctx, flutter.gain, t, 11, 0.12),
    ];
  }),
  // Click-clack: two small ticks, the second lower.
  switch: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", 3000, 2], peak: 0.45, d: 0.02 }],
    [hiss, { at: 0.06, filter: ["bandpass", 1800, 2], peak: 0.4, d: 0.03 }],
    [tone, { at: 0.06, f: 300, peak: 0.12, d: 0.03 }],
  ]),
  // A dry click and a dull nothing: the gun is empty.
  empty: (ctx, out) => shot(ctx, out, [
    [hiss, { filter: ["bandpass", 2200, 4], peak: 0.6, d: 0.015 }],
    [tone, { wave: "square", f: 140, filter: ["lowpass", 800], peak: 0.15, d: 0.04 }],
  ]),
};
