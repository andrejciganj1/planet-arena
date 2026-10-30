// An explosion's look over its life, pure (no three.js, so the tests check it); look/blast.js draws it. A flash,
// a fireball that swells to the blast's reach and darkens into rising smoke, a fast shock ring and sparks.
import { LOOK } from "../../tuning.js";

const out = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;

// age: s since the blast; size: m, its reach (the rocket's splash). Brightnesses 0..1, sizes in m.
export function blastLook(age, size, cfg = LOOK.blast) {
  if (age >= cfg.life) return { flash: 0, fire: 0, fireSize: 0, smoke: 0, smokeSize: 0, ring: 0, ringSize: 0, sparks: 0, light: 0 };
  const flash = age < cfg.flash ? (1 - age / cfg.flash) ** 2 : 0;
  const fireSize = size * (0.35 + 0.65 * out(age / cfg.grow));
  const fire = age < cfg.grow ? 1 : Math.max(0, 1 - (age - cfg.grow) / cfg.burn);
  // Smoke takes over as the fire dies, thinning out by the end of the blast's life.
  const k = (age - cfg.grow * 0.8) / (cfg.life - cfg.grow * 0.8);
  const smoke = k <= 0 ? 0 : Math.min(1, k / 0.15) * (1 - k) ** 1.2;
  const smokeSize = size * (1 + cfg.billow * Math.max(0, k));
  const ring = age < cfg.ring ? 1 - age / cfg.ring : 0;
  const ringSize = cfg.ringReach * size * out(age / cfg.ring);
  const sparks = age < cfg.sparks ? 1 - age / cfg.sparks : 0;
  return { flash, fire, fireSize, smoke, smokeSize, ring, ringSize, sparks, light: Math.max(flash, 0.6 * fire) };
}

// Which of the pool's slots a new blast takes: a free one (null) first, a new one while under `max`, else the
// oldest, so a burst of blasts never grows the pool or stalls a frame. slots: ages in s, or null when free.
export function pickSlot(slots, max) {
  const free = slots.indexOf(null);
  if (free >= 0) return free;
  if (slots.length < max) return slots.length;
  let oldest = 0;
  for (let i = 1; i < slots.length; i++) if (slots[i] > slots[oldest]) oldest = i;
  return oldest;
}
