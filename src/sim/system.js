// The solar system's bodies and where they are at a given match time. Orbits are scripted from the clock
// alone, so every machine computes the same positions: circles in the XZ plane for planets and moons,
// tilted ellipses for comets. Comet timing is softened Kepler (see ellipse), so far out they don't crawl.

import { add } from "./vec.js";

const DEG = Math.PI / 180;

// Position and velocity on a tilted ellipse round the parent: the orbit in its own plane (x towards the
// closest point), turned by arg within that plane, tilted by inc, then turned about y by node.
// Timing: M = E - kepler * e * sin E. kepler 1 is Kepler's law (very fast at peri, a crawl at apo); 0 moves
// evenly in E. In between keeps a rush past the sun without the long slow stretch far out.
function ellipse({ peri, apo, period, phase, inc, node, arg, kepler = 1 }, t) {
  const a = (peri + apo) / 2, e = (apo - peri) / (apo + peri), b = a * Math.sqrt(1 - e * e), n = (2 * Math.PI) / period;
  // Mean anomaly wrapped first, so hours into a match it stays exact.
  const M = (((phase + n * t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = M;
  const k = kepler * e;
  for (let i = 0; i < 12; i++) E -= (E - k * Math.sin(E) - M) / (1 - k * Math.cos(E));
  const dE = n / (1 - k * Math.cos(E));
  const turn = ([x, y]) => {
    const cw = Math.cos(arg * DEG), sw = Math.sin(arg * DEG), ci = Math.cos(inc * DEG), si = Math.sin(inc * DEG);
    const cn = Math.cos(node * DEG), sn = Math.sin(node * DEG);
    const x1 = x * cw - y * sw, z1 = x * sw + y * cw;
    const y2 = z1 * si, z2 = z1 * ci;
    return [x1 * cn - z2 * sn, y2, x1 * sn + z2 * cn];
  };
  return {
    pos: turn([a * (Math.cos(E) - e), b * Math.sin(E)]),
    vel: turn([-a * Math.sin(E) * dE, b * Math.cos(E) * dE]),
  };
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
  return { bodies, byId, order };
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
