// The server's tick under load: an online world with 8 players running, firing rockets and throwing hooks,
// through a solar flare and asteroid showers. Prints ms per tick (mean and 99th percentile).
//   node tools/bench.mjs [ticks]
import * as tuning from "../src/tuning.js";
import { createWorld, addPlayer, stepWorld } from "../src/sim/world.js";
import { flareAt } from "../src/sim/flares.js";
import { NO_INPUT } from "../src/sim/entity.js";

const ticks = Number(process.argv[2] ?? 3600);
const world = createWorld(tuning, { solo: false });
const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
for (const [i, id] of ids.entries()) addPlayer(world, id, { name: id, colour: tuning.COLOURS[i % tuning.COLOURS.length] });
for (const e of Object.values(world.entities)) (e.weapons = [...tuning.WEAPON_ORDER]), (e.ammo = { rocket: 1e6 }), (e.weapon = "rocket");
// Start a few seconds before a flare's warning, so the run covers the warning and the burn.
const f = flareAt(0);
world.t = f.warnAt - 5;
const input = (k, i) => ({ ...NO_INPUT, move: [Math.sin(k / 50 + i), 1], fire: k % 20 === i, hook: (k + 7 * i) % 120 < 60, jump: k % 90 === i, yawDelta: 0.01, pitchDelta: Math.sin(k / 30) * 0.01 });
const times = [];
for (let k = 0; k < ticks; k++) {
  const inputs = Object.fromEntries(ids.map((id, i) => [id, input(k, i)]));
  const t0 = performance.now();
  stepWorld(world, inputs, tuning.TICK);
  times.push(performance.now() - t0);
  world.events.length = 0;
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`${ticks} ticks, 8 players: ${mean.toFixed(3)} ms mean, ${times[Math.floor(0.99 * times.length)].toFixed(3)} ms p99, ${times.at(-1).toFixed(2)} ms worst`);
