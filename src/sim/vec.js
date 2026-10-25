// Vector maths on plain [x, y, z] arrays. Every function returns a new array, so callers can share
// vectors freely without aliasing bugs.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A zero vector stays zero rather than becoming NaN, so a degenerate direction can't poison a frame.
export function norm(a) {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
}

export const projectOnPlane = (v, n) => sub(v, scale(n, dot(v, n)));

export function clampLen(v, max) {
  const l = len(v);
  return l > max ? scale(v, max / l) : [v[0], v[1], v[2]];
}

// Rodrigues' rotation of v about the unit axis by angle (right handed).
export function rotateAxis(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

// Some unit vector perpendicular to unit a.
export function anyPerpendicular(a) {
  const other = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(a, other));
}

// Rotates v by the smallest rotation taking unit `from` onto unit `to`. For opposite vectors any half
// turn will do; we pick one about an axis perpendicular to `from` so the result stays well defined.
export function rotateFromTo(v, from, to) {
  const c = dot(from, to);
  if (c < -1 + 1e-9) return rotateAxis(v, anyPerpendicular(from), Math.PI);
  const axis = cross(from, to);
  const s = len(axis);
  if (s < 1e-12) return [v[0], v[1], v[2]];
  return rotateAxis(v, scale(axis, 1 / s), Math.atan2(s, c));
}
