// Pure choices for the props (no three.js, so the tests check them): which model a pickup shows, where a
// comet's two tails run, its coma and jets, and the grappling hook's pose. look/props.js draws them.
import { LOOK } from "../../tuning.js";
import { hashRand } from "../../sim/weapons.js";
import { add, sub, scale, dot, norm, len, dist } from "../../sim/vec.js";

// The model a pickup shows: { file, node, tint }. A weapon shows that gun (from weapons.glb); ammo a crate whose
// accent takes the weapon's colour; health and fuel their own (from props.glb).
export function pickupModel(pk) {
  if (pk.kind === "weapon") return { file: "weapons", node: pk.weapon, tint: null };
  if (pk.kind === "ammo") return { file: "props", node: "ammo", tint: LOOK.weapons.colors[pk.weapon] };
  return { file: "props", node: pk.kind, tint: null };
}

// A comet's tails, both away from the sun: { ion, dust }, each { from, away, lag, length, bend, width }. The
// ion tail is the gas the solar wind blows straight out; the dust is left behind along the path, so it bends
// back across it (lag: the way the comet came, across the sun line). Both grow as the comet nears the sun.
//   pos, vel: the comet's; sun: the sun's position
export function cometTails(pos, vel, sun, cfg = LOOK.props.comets) {
  const d = dist(pos, sun), away = norm(sub(pos, sun));
  const sideways = sub(vel, scale(away, dot(vel, away)));
  const lag = len(sideways) > 1e-6 ? scale(norm(sideways), -1) : [0, 0, 0];
  const length = ([base, reach, most]) => Math.min(most, base + reach / d);
  const tail = (c, bend) => ({ from: pos, away, lag, length: length(c.length), bend, width: c.width });
  return { ion: tail(cfg.ion, 0), dust: tail(cfg.dust, cfg.dust.bend) };
}

// A point along a tail, s from 0 (at the comet) to 1 (the tip): out along `away`, and `bend` of the way across
// per metre at the tip, growing with the square of s, so the dust tail is a curve that leaves the comet
// straight out.
export function tailAt(tail, s) {
  const out = s * tail.length;
  return add(add(tail.from, scale(tail.away, out)), scale(tail.lag, tail.bend * s * out));
}

// How stirred a comet is at d m from the sun: 1 within cfg.stir, falling off further out.
export const cometStir = (d, cfg = LOOK.props.comets) => Math.min(1, cfg.stir / d);

// The haze round a comet: { size (m across), opacity }, from how stirred it is and how far the eye is from its
// surface (gap, m): it fades away as you come close, so it never fogs the view while you stand on the comet.
export function comaLook(stir, gap, radius, cfg = LOOK.props.comets) {
  const { size, opacity, fade } = cfg.coma, mix = (a) => a[0] + (a[1] - a[0]) * stir;
  const k = Math.min(1, Math.max(0, (gap - fade[0]) / (fade[1] - fade[0])));
  return { size: radius * mix(size), opacity: mix(opacity) * k * k * (3 - 2 * k) };
}

// Where on a comet its jets vent: cfg.jets.count unit directions, the same on every load, its own per comet.
export function jetVents(id, cfg = LOOK.props.comets) {
  const next = hashRand(`vents|${id}`);
  return Array.from({ length: cfg.jets.count }, () => {
    const z = 2 * next() - 1, a = 2 * Math.PI * next(), s = Math.sqrt(1 - z * z);
    return [s * Math.cos(a), s * Math.sin(a), z];
  });
}

// A jet this frame: { dir (unit, out of the surface and bent away from the sun), length (m), opacity }. A vent
// blows only while the sun is on it, strongest facing the sun.
//   at: the vent (unit, from the comet's centre); toSun: unit, from the comet to the sun
export function jetLook(at, toSun, stir, cfg = LOOK.props.comets) {
  const { length, opacity, sunward, back } = cfg.jets;
  const facing = Math.min(1, Math.max(0, dot(at, toSun) / sunward));
  const dir = norm(sub(at, scale(toSun, back * Math.max(0, dot(at, toSun)))));
  return { dir, length: length[0] + (length[1] - length[0]) * stir, opacity: opacity * facing * stir };
}

// The grappling hook's prongs and spin: state "flying" (folded, spinning), "caught" (snapping open over `snap`
// s) or "reeling" (back to the hand, folding over `reel` s); since: s in that state. open: 0 folded, 1 dug in.
export function hookPose(state, since, cfg = LOOK.props.hook) {
  const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
  if (state === "flying") return { open: 0, spin: cfg.spin * since };
  if (state === "caught") return { open: ease(since / cfg.snap), spin: 0 };
  return { open: 1 - Math.min(1, since / cfg.reel), spin: 0 };
}
