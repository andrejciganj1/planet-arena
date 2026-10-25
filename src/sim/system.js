// The solar system's bodies and where they are at a given match time. Orbits are scripted circles in
// the XZ plane, so every machine computes the same positions from the clock alone.

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
    const { around, radius, period, phase } = b.orbit;
    const parent = poses[around];
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
