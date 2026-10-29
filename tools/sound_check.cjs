// Sound check: opens the sound test page, renders every recipe in an OfflineAudioContext (one-shots 3 s,
// loops 2 s, 44.1 kHz, mono) and prints per sound the peak, the RMS and when it falls below -50 dB. OK when
// every one-shot is audible (peak above -30 dB), never clips (peak at most 0 dB) and ends within 1.5 s (the
// scream, a drawn-out "Nooo!", within 2.5 s), and every loop is
// audible, never clips, is steady (RMS of its second second within 6 dB of its first) and, stopped at 1 s,
// is silent by 1.5 s. We can't hear; this says each sound is there, whole and short. The voice files are
// loaded before rendering, so a missing file fails its sound as too quiet.
// Usage: NODE_PATH=... node tools/sound_check.cjs <url of sounds.html>
const { chromium } = require("playwright");
const LONGEST = { scream: 2.5 }; // s; every other one-shot 1.5
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage();
  let bad = false;
  p.on("console", (m) => m.type() === "error" && ((bad = true), console.log("console error:", m.text().slice(0, 300))));
  p.on("pageerror", (e) => ((bad = true), console.log("pageerror:", e.message)));
  await p.goto(process.argv[2]);
  await p.waitForFunction(() => window.soundtest, null, { timeout: 15000 });
  const rows = await p.evaluate(async () => {
    const { SOUNDS, RECIPES, LOOPS } = window.soundtest;
    const rate = 44100, len = 2 * rate, quiet = 10 ** (-50 / 20);
    // The voice files must be decoded first, or their renders would be silent.
    const { loadVoice } = await import(new URL("src/client/synth.js", location.href).href);
    await loadVoice(new OfflineAudioContext(1, 1, rate));
    const render = async (name, stopAt) => {
      const ctx = new OfflineAudioContext(1, LOOPS.has(name) ? len : 1.5 * len, rate);
      const h = RECIPES[name](ctx, ctx.destination, {});
      if (stopAt) ctx.suspend(stopAt).then(() => (h.stop(), ctx.resume()));
      return (await ctx.startRendering()).getChannelData(0);
    };
    const rms = (d, a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += d[i] * d[i];
      return Math.sqrt(s / Math.max(1, b - a));
    };
    const lastLoud = (d) => {
      for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > quiet) return (i + 1) / rate;
      return 0;
    };
    const out = [];
    for (const name of SOUNDS) {
      const d = await render(name);
      let peak = 0;
      for (const v of d) peak = Math.max(peak, Math.abs(v));
      const ends = lastLoud(d), loop = LOOPS.has(name);
      const row = { name, loop, peak, ends, rms: rms(d, 0, Math.max(1, Math.round(ends * rate))) };
      if (loop) Object.assign(row, { rms: rms(d, 0, len), first: rms(d, 0, len / 2), second: rms(d, len / 2, len), stopped: lastLoud(await render(name, 1)) });
      out.push(row);
    }
    return out;
  });
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
  const f = (v) => db(v).toFixed(1).padStart(6);
  for (const r of rows) {
    const why = [];
    if (db(r.peak) <= -30) why.push("too quiet");
    if (r.peak > 1) why.push("clips");
    if (!r.loop && r.ends > (LONGEST[r.name] ?? 1.5)) why.push("too long");
    if (r.loop && Math.abs(db(r.first) - db(r.second)) > 6) why.push("unsteady");
    if (r.loop && r.stopped > 1.5) why.push("doesn't stop");
    if (why.length) bad = true;
    const tail = r.loop
      ? `halves ${f(r.first)} ${f(r.second)} dB  stopped at 1 s, silent by ${r.stopped.toFixed(2)} s`
      : `below -50 dB at ${r.ends.toFixed(2)} s`;
    console.log(`${r.name.padEnd(13)} ${r.loop ? "loop" : "shot"}  peak ${f(r.peak)} dB  rms ${f(r.rms)} dB  ${tail}${why.length ? "  FAIL: " + why.join(", ") : ""}`);
  }
  await b.close();
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
