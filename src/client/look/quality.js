// The automatic quality step: the renderer asks it each frame which level to draw at (0 lowest). Frames are
// judged a `window` s at a time, so one hitch doesn't count: a slow window (average frame over `down` s)
// drops a level, and only `up` s of windows in a row that weren't slow climb one back. Judging whole
// windows also means it never changes twice within one. A frame over `pause` s is a hidden tab coming
// back, not a slow frame, and is left out.
export function createQuality({ levels = 3, down, up, window, pause = 0.25 }) {
  let time = 0, frames = 0, steady = 0;
  const q = {
    level: levels - 1,
    frame(dt) {
      if (!(dt > 0) || dt > pause) return q.level;
      time += dt;
      frames++;
      if (time < window) return q.level;
      const slow = time / frames > down;
      steady = slow ? 0 : steady + time;
      time = frames = 0;
      if (slow && q.level > 0) q.level--;
      else if (steady >= up && q.level < levels - 1) (q.level++, (steady = 0));
      return q.level;
    },
  };
  return q;
}
