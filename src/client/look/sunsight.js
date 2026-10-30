// How much of the sun is in sight from an eye, 0..1: the share of a few points across its disc that no body
// covers. Every body is a sphere, so a ray test is exact enough, and cheap enough for every frame. Pure, so
// it runs under node tests. Plain numbers rather than vector arrays: it runs every frame the sun is in view.

// Points on the disc in sun radii, x, y pairs: the centre and two rings, so a planet edge crossing it fades
// the glow.
const DISC = [0, 0];
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4;
  DISC.push(0.45 * Math.cos(a), 0.45 * Math.sin(a), 0.85 * Math.cos(a + 0.4), 0.85 * Math.sin(a + 0.4));
}

//   blockers: [{ pos, radius }], every body but the sun
export function sunInSight(eye, sun, radius, blockers) {
  let fx = sun[0] - eye[0], fy = sun[1] - eye[1], fz = sun[2] - eye[2];
  const d = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (d <= radius) return 1;
  (fx /= d), (fy /= d), (fz /= d);
  // Two axes across the disc: a = f x (up, or x when f is nearly up), b = f x a.
  const side = Math.abs(fy) < 0.9;
  let ax = side ? -fz : 0, ay = side ? 0 : fz, az = side ? fx : -fy;
  const al = Math.sqrt(ax * ax + ay * ay + az * az);
  (ax /= al), (ay /= al), (az /= al);
  const bx = fy * az - fz * ay, by = fz * ax - fx * az, bz = fx * ay - fy * ax;
  let seen = 0;
  for (let i = 0; i < DISC.length; i += 2) {
    const x = DISC[i] * radius, y = DISC[i + 1] * radius;
    let ux = sun[0] + ax * x + bx * y - eye[0], uy = sun[1] + ay * x + by * y - eye[1], uz = sun[2] + az * x + bz * y - eye[2];
    const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
    (ux /= l), (uy /= l), (uz /= l);
    let covered = false;
    for (const { pos, radius: r } of blockers) {
      // Does the segment from the eye along u for l metres pass through this sphere?
      const ox = eye[0] - pos[0], oy = eye[1] - pos[1], oz = eye[2] - pos[2];
      const c = ox * ox + oy * oy + oz * oz - r * r;
      if (c < 0) { covered = true; break; }
      const b = ox * ux + oy * uy + oz * uz, disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < l) { covered = true; break; }
    }
    if (!covered) seen++;
  }
  return (2 * seen) / DISC.length;
}
