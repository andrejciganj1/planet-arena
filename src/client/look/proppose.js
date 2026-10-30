// Pure choices for the props (no three.js, so the tests check them): which model a pickup shows, and where a
// comet's two tails run. look/props.js draws them.
import { LOOK } from "../../tuning.js";
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
