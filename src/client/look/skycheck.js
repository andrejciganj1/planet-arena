import { LOOK } from "../../tuning.js";

// Whether the sky bake worked, from what the page can see of it: it threw, WebGL reported an error, or one
// texel read back from the cube map is missing the sky's own colour (a shader that failed to build, or a
// render target the GPU can't draw into, leaves only the black clear colour). Pure, so it runs under node.
// The sky shader never paints darker than its floor colour, sRGB (5, 6, 13): blue at least 8 means it drew.
//   pixel: [r, g, b, a] bytes or null; glError: gl.getError() after the bake; error: what was thrown
export function skyPainted({ error = null, pixel, glError }) {
  return !error && glError === 0 && !!pixel && pixel[3] === 255 && pixel[2] >= 8;
}

// The Milky Way's glow across the sky, 0..1, before its noise and dust: a band round the great circle square to
// `pole`, `width` (the sine of its half-height) wide, brighter towards `core`. look/sky.js paints the same.
//   d: a unit direction
export function milkyBand(d, cfg = LOOK.sky.milky) {
  const n = Math.hypot(...cfg.pole), b = (d[0] * cfg.pole[0] + d[1] * cfg.pole[1] + d[2] * cfg.pole[2]) / n;
  const c = 0.5 + 0.5 * (d[0] * cfg.core[0] + d[1] * cfg.core[1] + d[2] * cfg.core[2]);
  return Math.exp(-(b * b) / (cfg.width * cfg.width)) * (0.55 + 0.45 * c * c);
}
