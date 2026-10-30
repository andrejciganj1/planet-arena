// The solar system's bodies and where they are at a given match time. Orbits are scripted from the clock
// alone, so every machine computes the same positions: circles in the XZ plane for planets and moons,
// tilted ellipses for comets. Comet timing is softened Kepler (see ellipse), so far out they don't crawl.

import { add } from "./vec.js";

const DEG = Math.PI / 180;

// Position and velocity on a tilted ellipse round the parent: the orbit in its own plane (x towards the
// closest point), turned by arg within that plane, tilted by inc, then turned about y by node.
// Timing: M = E - kepler * e * sin E. kepler 1 is Kepler's law (very fast at peri, a crawl at apo); 0 moves
// evenly in E. In between keeps a rush past the sun without the long slow stretch far out.
// Each orbit's shape and turn are worked out once (pad cues ask for thousands of poses a second).
const shapes = new WeakMap();
function shapeOf(o) {
  let s = shapes.get(o);
  if (s) return s;
  const a = (o.peri + o.apo) / 2, e = (o.apo - o.peri) / (o.apo + o.peri);
  const cw = Math.cos(o.arg * DEG), sw = Math.sin(o.arg * DEG), ci = Math.cos(o.inc * DEG), si = Math.sin(o.inc * DEG);
  const cn = Math.cos(o.node * DEG), sn = Math.sin(o.node * DEG);
  s = { a, e, b: a * Math.sqrt(1 - e * e), n: (2 * Math.PI) / o.period, k: (o.kepler ?? 1) * e, cw, sw, ci, si, cn, sn };
  shapes.set(o, s);
  return s;
}

function ellipse(o, t) {
  const { a, e, b, n, k, cw, sw, ci, si, cn, sn } = shapeOf(o);
  // Mean anomaly wrapped first, so hours into a match it stays exact.
  const M = (((o.phase + n * t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Newton's method, stopped once a step no longer moves it (a handful of steps; never more than 12).
  let E = M;
  for (let i = 0; i < 12; i++) {
    const step = (E - k * Math.sin(E) - M) / (1 - k * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  const sE = Math.sin(E), cE = Math.cos(E), dE = n / (1 - k * cE);
  const turn = (x, y) => {
    const x1 = x * cw - y * sw, z1 = x * sw + y * cw;
    const z2 = z1 * ci;
    return [x1 * cn - z2 * sn, z1 * si, x1 * sn + z2 * cn];
  };
  return { pos: turn(a * (cE - e), b * sE), vel: turn(-a * sE * dE, b * cE * dE) };
}

export function createSystem(bodies) {
  const byId = {};
  for (const b of bodies) byId[b.id] = b;
  // Parents before children, so a moon can add its planet's pose.
  const order = [];
  const visit = (b) => {
    if (order.includes(b)) return;
    if (b.orbit) visit(byId[b.orbit.around]);
    order.push(b);
  };
  bodies.forEach(visit);
  // The sun, found once: many hot paths need it every tick.
  return { bodies, byId, order, sun: bodies.find((b) => b.kind === "sun") };
}

export function posesAt(system, t) {
  const poses = {};
  for (const b of system.order) {
    if (!b.orbit) {
      poses[b.id] = { pos: [...(b.pos || [0, 0, 0])], vel: [0, 0, 0] };
      continue;
    }
    const parent = poses[b.orbit.around];
    if (b.orbit.peri) {
      const e = ellipse(b.orbit, t);
      poses[b.id] = { pos: add(parent.pos, e.pos), vel: add(parent.vel, e.vel) };
      continue;
    }
    const { radius, period, phase } = b.orbit;
    const w = (2 * Math.PI) / period;
    const a = phase + w * t;
    const c = Math.cos(a), s = Math.sin(a);
    poses[b.id] = {
      pos: [parent.pos[0] + radius * c, parent.pos[1], parent.pos[2] + radius * s],
      vel: [parent.vel[0] - radius * w * s, parent.vel[1], parent.vel[2] + radius * w * c],
    };
  }
  return poses;
}
