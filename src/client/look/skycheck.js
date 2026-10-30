// Whether the sky bake worked, from what the page can see of it: it threw, WebGL reported an error, or one
// texel read back from the cube map is missing the sky's own colour (a shader that failed to build, or a
// render target the GPU can't draw into, leaves only the black clear colour). Pure, so it runs under node.
// The sky shader never paints darker than its floor colour, sRGB (5, 6, 13): blue at least 8 means it drew.
//   pixel: [r, g, b, a] bytes or null; glError: gl.getError() after the bake; error: what was thrown
export function skyPainted({ error = null, pixel, glError }) {
  return !error && glError === 0 && !!pixel && pixel[3] === 255 && pixel[2] >= 8;
}
