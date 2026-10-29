// The automatic quality step: the renderer asks it each frame which level to draw at (0 lowest). Frames are
// judged a `window` s at a time, so one hitch doesn't count: a slow window (average frame over `down` s)
// drops a level, and only windows that weren't slow, for as long as the level above needs, climb one back.
// Judging whole windows also means it never changes twice within one.
// A level that failed waits twice as long before the next try (up to `maxUp` s), so a machine that is fast
// one level down and slow at the next settles there with a rare short try, instead of flipping every few
// seconds; holding a level for `maxUp` s trusts it again.
// A single frame over `pause` s is a hidden tab coming back and is left out; a run of them is a machine
// below a few frames a second, and counts.
// The pixel ratio to draw at on a screen of `dpr` device pixels per CSS pixel, at `level`: at most `most`, and
// the lower levels draw `res` of that, but never under one device pixel per CSS pixel (nor over the screen's
// own). Below that a normal screen only blurs, and on this game a slow frame is mostly the CPU, not pixels.
export function pixelRatio(dpr, level, { res, most }) {
  const top = Math.min(dpr, most);
  return Math.min(top, Math.max(1, top * res[level]));
}

export function createQuality({ levels = 3, down, up, window, pause = 0.25, maxUp = 8 * up }) {
  const need = Array(levels).fill(up); // s of steady windows before climbing into each level
  let time = 0, frames = 0, steady = 0, since = 0, long = 0, inRun = false;
  const change = (to) => ((q.level = to), (steady = since = 0));
  const q = {
    level: levels - 1,
    frame(dt) {
      if (!(dt > 0)) return q.level;
      let n = 1;
      if (dt <= pause) inRun = false;
      else if (!inRun) return ((inRun = true), (long = dt), q.level); // held back: it may be a lone pause
      else (dt += long), (n += long ? 1 : 0), (long = 0); // a run: the held frame counts too
      time += dt;
      frames += n;
      since += dt;
      if (time < window) return q.level;
      const slow = time / frames > down;
      steady = slow ? 0 : steady + time;
      time = frames = 0;
      if (since >= maxUp) need[q.level] = up;
      if (slow && q.level > 0) {
        need[q.level] = Math.min(maxUp, 2 * need[q.level]);
        change(q.level - 1);
      } else if (q.level < levels - 1 && steady >= need[q.level + 1]) change(q.level + 1);
      return q.level;
    },
  };
  return q;
}
