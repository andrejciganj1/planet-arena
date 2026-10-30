// Look check: screenshots of a fixed list of views with the match clock standing still (?at), so two runs
// can be compared pixel for pixel. Views are worked out from the world itself: each planet from afar and
// standing on its day and night side, a moon and a comet from afar, the sun, the sky, and the dummy on a night
// side seen from 30 m (the tiny planet; the heavy desert and the ocean from inside their shadows, where the
// planet hides the whole sun so no glow brightens the screen). In the last two the dummy must stand out from
// the ground behind it, its name tag hidden: the mean brightness of its pixels and of the same pixels without
// it (the ground) differ by at least NIGHT_CONTRAST of full scale, over at least SEEN_SHARE of its outline
// (its two hit spheres projected), so a few stray pixels can't pass. That holds for the grey dummy and for
// the dummy drawn in every player colour (COLOURS). The alien close up by day and night (grey, and as a blue
// player) and in third person walking, boosting and on the hook, to look at. Each weapon in first person, at
// rest and firing (a shot every frame, so the kick and the flash show), one firing on a night side, and in an
// alien's hand firing, seen from the side. The props (propViews): pickups, pads, the belt, a flying rock and a
// comet's tails. Sums the bytes of every file under assets/ the page fetched.
// Performance, on a 2x screen with a 960x540 window (so the top level draws 1080p): in one view, each quality
// level held for 5 s: the average frame time, the work per frame (from the frame's start until the GPU has
// finished it, so it shows the cost under the 60 fps cap) and the draw calls and triangles; a warning when
// the top level misses 60 fps. Then the quality step on a slow machine: the live game with the CPU slowed 4x
// must drop a level within THROTTLE_DROP s, then stay down: no climb for LOOK.quality.up + window s after the
// drop (the steady stretch a climb needs, so a climb in that time is flipping; later ones depend on the
// machine, so they aren't judged).
// Prints one line per view, then OK when there were no page errors, the dummy was seen, the frame time was
// measured, the throttled run passed and the assets fit in LOOK.budget.
// Usage: NODE_PATH=... node tools/look_check.cjs <base url, e.g. http://localhost:8100/> <out dir> [views]
// views: a pattern for the view names to take (while working on one look); the checks then cover only those.
// The timing runs when the pattern takes TIMED, the throttled run when it takes "throttled".
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AT = 40; // s on the match clock for every view
const TIMED = "mid-day"; // the view whose frame time is measured
const SEEN = ["dummy-night", "dummy-night-ocean"]; // the views whose dummy must stand out
const NIGHT_CONTRAST = 0.06; // of full scale (sRGB luminance), dummy against the ground behind it
const SEEN_SHARE = 0.5; // of the dummy's projected outline that must differ from the empty ground
const FOV = 80, W = 1280, H = 800; // the camera and the window
const THROTTLE_DROP = 10; // s

const v = {
  add: (a, b) => a.map((x, i) => x + b[i]),
  sub: (a, b) => a.map((x, i) => x - b[i]),
  scale: (a, k) => a.map((x) => x * k),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
v.norm = (a) => v.scale(a, 1 / Math.hypot(...a));
const Y = [0, 1, 0];

// Every view as { name, eye, target, dummy? } from the bodies at the still moment.
function views(world) {
  const { bodies, poses, eye: eyeHeight, weapons } = world;
  const sun = poses.sun, list = [];
  for (const b of bodies.filter((b) => b.kind === "planet" || b.id === "moon" || b.id === "comet-a")) {
    const c = poses[b.id], s = v.norm(v.sub(sun, c));
    const sHoriz = v.norm([s[0], 0, s[2]]), side = v.norm(v.cross(Y, sHoriz));
    // From afar: lit side and terminator both in view, a little above the orbital plane.
    const far = v.norm(v.add(v.add(v.scale(sHoriz, 0.8), v.scale(side, 0.6)), v.scale(Y, 0.35)));
    list.push({ name: `${b.id}-afar`, eye: v.add(c, v.scale(far, b.radius * 3.2 + 8)), target: c });
    if (b.kind !== "planet") continue;
    // Standing 60 degrees from the pole towards (day) or away from (night) the sun, looking along the ground
    // that way, so the horizon is level; aimed a little below the tangent, where the horizon is.
    const th = Math.PI / 3, dip = 0.6 * Math.acos(b.radius / (b.radius + eyeHeight));
    for (const [name, k] of [["day", 1], ["night", -1]]) {
      const up = v.add(v.scale(Y, Math.cos(th)), v.scale(sHoriz, k * Math.sin(th)));
      const along = v.add(v.scale(sHoriz, k * Math.cos(th)), v.scale(Y, -Math.sin(th)));
      const at = v.add(c, v.scale(up, b.radius + eyeHeight));
      const dir = v.add(v.scale(along, Math.cos(dip)), v.scale(up, -Math.sin(dip)));
      list.push({ name: `${b.id}-${name}`, eye: at, target: v.add(at, v.scale(dir, 20)) });
    }
  }
  list.push({ name: "sun", eye: v.add(sun, v.scale(v.norm([1, 0.35, 0.6]), 90)), target: sun });
  list.push({ name: "sky", eye: [0, 60, 0], target: [300, 900, 200] });
  // The outer ring from near the edge of the game, and from the far planet's orbit.
  list.push({ name: "outer-ring", eye: [60, 40, 560], target: [-80, -5, 715] });
  list.push({ name: "outer-ring-far", eye: [0, 50, 330], target: [200, 0, 700] });
  // The Milky Way towards its core, from out past the far planet so no body is in the way.
  list.push({ name: "milky-way", eye: [0, 30, 380], target: [0, 120, 1380] });
  // The dummy on the tiny planet's night side, seen from 30 m and from high up, so the dark ground is behind it.
  const tiny = bodies.find((b) => b.id === "tiny"), c = poses.tiny, s = v.norm(v.sub(sun, c));
  const up = v.norm(v.add(v.scale(s, -1), v.scale(Y, 0.35))), pos = v.add(c, v.scale(up, tiny.radius));
  const across = v.norm(v.cross(up, s)), forward = v.norm(v.cross(across, up));
  list.push({
    name: "dummy-night-tiny",
    eye: v.add(pos, v.scale(v.norm(v.add(up, v.scale(across, 0.5))), 30)),
    target: v.add(pos, v.scale(up, 1)),
    dummy: { pos, up, forward },
  });
  // The dummy at a planet's midnight, seen from 30 m at `deg` degrees above its horizon, the eye inside the
  // planet's shadow so the planet hides the whole sun: the desert at 55 (17 m off the axis, radius 23) and the
  // ocean, a smaller planet nearer the sun, almost from above at 85 (3 m off the axis, radius 12).
  for (const [name, id, deg] of [["dummy-night", "heavy", 55], ["dummy-night-ocean", "mid", 85]]) {
    const body = bodies.find((b) => b.id === id), bc = poses[id], bs = v.norm(v.sub(sun, bc));
    const bup = v.scale(bs, -1), bpos = v.add(bc, v.scale(bup, body.radius));
    const bacross = v.norm(v.cross(Y, bs)), el = (deg * Math.PI) / 180;
    list.push({
      name,
      eye: v.add(bpos, v.scale(v.add(v.scale(bup, Math.sin(el)), v.scale(bacross, Math.cos(el))), 30)),
      target: v.add(bpos, v.scale(bup, 1)),
      dummy: { pos: bpos, up: bup, forward: v.norm(v.cross(bacross, bup)) },
    });
  }
  // Close up, the alien by day and by night on the ocean planet, from the front and a little to one side; then
  // in third person, walking and aiming up, boosting (and as a blue player at night from 14 m), and swinging on
  // the hook by day, seen from the side the sun
  // lights. `state` is set on the dummy as well as where it stands, `lift` m above the ground; `boost` burns its
  // fuel every frame, as a boost does. The figure stands `deg` degrees from the pole towards the sun (day) or away
  // (night), so the camera's up (world y) is near the figure's.
  const mid = bodies.find((b) => b.id === "mid"), mc = poses.mid, ms = v.norm(v.sub(sun, mc));
  const mHoriz = v.norm([ms[0], 0, ms[2]]);
  const close = (name, k, deg, { side = false, dist = 4.2, state = {}, boost = false, as = null, fire = false, lift = 0 } = {}) => {
    const el = (deg * Math.PI) / 180;
    const up = v.norm(v.add(v.scale(Y, Math.cos(el)), v.scale(mHoriz, k * Math.sin(el))));
    const pos = v.add(mc, v.scale(up, mid.radius + lift));
    const across = v.norm(v.cross(mHoriz, up)), sunward = v.cross(up, across);
    // Front: facing the sun, seen from in front and a little to one side. Side: walking across the sun's
    // direction (its gun side to the sun), seen from that side, a little ahead and above.
    const forward = side ? v.scale(across, -1) : sunward;
    const look = side ? v.norm(v.add(v.add(sunward, v.scale(forward, 0.6)), v.scale(up, 0.2))) : v.norm(v.add(sunward, v.scale(across, 0.5)));
    const eye = v.add(v.add(pos, v.scale(up, 1.3)), v.scale(look, dist));
    const { walk = 0, ...rest } = state;
    return { name, eye, target: v.add(pos, v.scale(up, 1.0)), dummy: { pos, up, forward, state: { groundId: "mid", vel: v.scale(forward, walk), ...rest }, boost, as, fire } };
  };
  // You, standing where `close` puts a figure, the sun behind you and a little to the right, so the gun in
  // view is lit from where you see it.
  const firstPerson = (name, k, weapon, fire) => {
    const el = (35 * Math.PI) / 180;
    const up = v.norm(v.add(v.scale(Y, Math.cos(el)), v.scale(mHoriz, k * Math.sin(el))));
    const across = v.norm(v.cross(mHoriz, up)), sunward = v.cross(up, across);
    const forward = v.norm(v.add(v.scale(sunward, -1), v.scale(across, 0.4)));
    return { name, fp: { pos: v.add(mc, v.scale(up, mid.radius)), up, forward, pitch: -0.2, weapon, fire } };
  };
  list.push(close("alien-day", 1, 35));
  list.push(close("alien-night", -1, 35));
  list.push(close("alien-night-blue", -1, 35, { as: 0x4fb0e8 }));
  list.push(close("alien-walk", 1, 40, { side: true, dist: 3.6, state: { walk: 7, pitch: 0.45 }, as: 0xe8505b }));
  // Hooked onto the ground 6 m ahead: the hook dug in, prongs open, the rope from the hand.
  const hookAt = (k, deg, ahead) => {
    const el = (deg * Math.PI) / 180, up = v.norm(v.add(v.scale(Y, Math.cos(el)), v.scale(mHoriz, k * Math.sin(el))));
    const fwd = v.scale(v.norm(v.cross(mHoriz, up)), -1); // the way a side view's figure faces
    return v.scale(v.norm(v.add(up, v.scale(fwd, ahead / mid.radius))), mid.radius);
  };
  list.push(close("hook-caught", 1, 35, { side: true, dist: 6, state: { hook: { body: "mid", offset: hookAt(1, 35, 4), len: 4 }, pitch: -0.2 } }));
  // A rocket blast 3 m in front of a figure on Mid, a fifth of a second in (`blast`: set off once the view is
  // ready, then `frames` frames drawn before the shot).
  const boom = close("explosion", 1, 35, { dist: 11 });
  boom.blast = { pos: v.add(boom.dummy.pos, v.add(v.scale(boom.dummy.up, 0.5), v.scale(boom.dummy.forward, 3))), splash: 4, frames: 12 };
  list.push(boom);
  list.push(close("alien-boost", 1, 40, { side: true, dist: 3.6, state: { groundId: null, airTime: 0.8, pitch: 0.1 }, boost: true, lift: 1 }));
  list.push(close("alien-boost-far", -1, 35, { side: true, dist: 14, state: { groundId: null, airTime: 0.8, pitch: 0.1 }, boost: true, lift: 1, as: 0x4fb0e8 }));
  list.push(close("alien-hook", 1, 40, { side: true, dist: 3.6, state: { groundId: null, airTime: 1.5, pitch: 0.3, hook: { body: "mid", offset: [0, 0, 0] } } }));
  for (const w of weapons) {
    list.push(firstPerson(`fp-${w}`, 1, w, false));
    list.push(firstPerson(`fp-${w}-fire`, 1, w, true));
  }
  list.push(firstPerson("fp-night-railgun", -1, "railgun", true));
  // Third person: over the shoulder with the rocket launcher, and looking steeply up, where the camera's spot
  // would be underground and it is pulled in.
  list.push({ ...firstPerson("third-person", 1, "rocket", false), shown: { third: true } });
  const steep = firstPerson("third-person-tight", 1, "rocket", false);
  list.push({ ...steep, fp: { ...steep.fp, pitch: 1.2 }, shown: { third: true } });
  for (const w of weapons) list.push(close(`hold-${w}`, 1, 40, { side: true, dist: 3, state: { weapon: w, pitch: 0.15 }, as: 0x4fb0e8, fire: true }));
  list.push(...propViews(world));
  return list;
}

// The props: each kind of pickup on the day side and the night side of its body (the spot facing the sun most
// and least), a pad by day with its cue shown and hidden and one by night, the belt from inside it, a flying
// rock with its trail (`rock`: moved along `vel` two ticks a frame, so the trail grows) and a comet near the
// sun from above its orbit (`at`: the clock then, so both tails are long), and a solar flare (`flare`: its
// times and main patch, the sun and Mid two seconds into its burn).
function propViews({ poses, pickups, pads, comet, flare }) {
  const sun = poses.sun, list = [];
  const sunward = (body, dir) => v.dot(dir, v.norm(v.sub(sun, poses[body])));
  const across = (n) => v.norm(v.cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : Y));
  const extreme = (items, k) => items.reduce((a, b) => (k * sunward(b.body, b.n) > k * sunward(a.body, a.n) ? b : a));
  for (const kind of ["health", "fuel", "ammo", "weapon"]) {
    for (const [name, k] of [["day", 1], ["night", -1]]) {
      const pk = extreme(pickups.filter((x) => x.kind === kind), k);
      const t = across(pk.n);
      list.push({ name: `pickup-${kind}-${name}`, eye: v.add(pk.at, v.add(v.scale(pk.n, 0.7), v.scale(t, 2.2))), target: v.add(pk.at, v.scale(pk.n, -0.2)) });
    }
  }
  for (const [name, k, shown] of [["pad-cue", 1, null], ["pad-nocue", 1, { cues: false }], ["pad-night", -1, null]]) {
    const pd = extreme(pads, k), t = across(pd.n);
    list.push({ name, eye: v.add(pd.at, v.add(v.scale(pd.n, 3), v.scale(t, 4.5))), target: v.add(pd.at, v.scale(pd.n, 0.5)), shown });
  }
  const a = 0.3, ring = (r, y, da = 0) => [r * Math.cos(a + da), y, r * Math.sin(a + da)];
  list.push({ name: "belt-close", eye: ring(146, 2.5), target: ring(155, 0, 0.12) });
  // The rock flies for about a second before the shot (two ticks a frame), so it starts a second back.
  const rock = v.add(poses.mid, [0, 30, 0]), vel = [12, 0, -3];
  list.push({ name: "asteroid", eye: v.add(rock, [2, 2, 10]), target: v.add(rock, [-1.5, 0, 0]), rock: { pos: v.sub(rock, vel), vel } });
  const away = v.norm(v.sub(comet.pos, comet.sun)), up = v.norm(v.cross(away, comet.vel));
  const mid = v.add(comet.pos, v.scale(away, 30));
  list.push({ name: "comet-tails", at: comet.t, eye: v.add(mid, v.add(v.scale(up, 55), v.scale(away, -10))), target: mid });
  // A solar flare: its main patch on the sun's edge late in the warning and at the burst, the cloud from
  // further out, and Mid's sunny side bleached two seconds into the burn, its night side still dark.
  const fl = flare, edge = v.norm(v.cross(Y, fl.dir));
  const limb = v.add(fl.sun, v.add(v.scale(edge, 95), v.scale(Y, 12)));
  list.push({ name: "flare-warn", at: fl.warnAt + 9, eye: limb, target: v.add(fl.sun, v.scale(fl.dir, 15)) });
  list.push({ name: "flare-burst", at: fl.burnAt + 0.6, eye: limb, target: v.add(fl.sun, v.scale(fl.dir, 15)) });
  list.push({ name: "flare-cloud", at: fl.burnAt + 3, eye: v.add(fl.sun, v.add(v.scale(edge, 170), v.scale(Y, 40))), target: v.add(fl.sun, v.scale(fl.dir, 40)) });
  const toSun = v.norm(v.sub(fl.sun, fl.mid)), mSide = v.norm(v.cross(Y, toSun));
  list.push({ name: "flare-mid", at: fl.burnAt + 2, eye: v.add(fl.mid, v.add(v.scale(toSun, 8), v.scale(mSide, 40))), target: fl.mid });
  return list;
}

// Where a world point lands on the screen, in pixels, and how many pixels a metre is there; null behind.
function project(view, p) {
  const f = v.norm(v.sub(view.target, view.eye)), r = v.norm(v.cross(f, Y)), u = v.cross(r, f), d = v.sub(p, view.eye);
  const z = v.dot(d, f), k = Math.tan((FOV * Math.PI) / 360);
  if (z <= 0) return null;
  return { x: (1 + v.dot(d, r) / (z * k * (W / H))) * W / 2, y: (1 - v.dot(d, u) / (z * k)) * H / 2, perM: H / 2 / (z * k) };
}

// The dummy's hit spheres on the screen, as pixel circles.
function dummyDiscs(view, hit) {
  return [hit.body, hit.head].map(({ at, r }) => {
    const c = project(view, v.add(view.dummy.pos, v.scale(view.dummy.up, at)));
    return { x: c.x, y: c.y, r: r * c.perM };
  });
}

// In the page: mean sRGB luminance (0..1) of the pixels inside the discs that differ between two screenshots,
// in each, how many there are and how many lie inside the discs at all.
const contrastIn = (p, a, b, discs) => p.evaluate(async ({ a, b, discs }) => {
  const pixels = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  };
  const A = await pixels(a), B = await pixels(b);
  const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  let n = 0, la = 0, lb = 0, inside = 0;
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    if (!discs.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r)) continue;
    inside++;
    const i = 4 * (y * A.width + x);
    if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) < 6) continue;
    n++, (la += lum(A.data, i)), (lb += lum(B.data, i));
  }
  return { n, inside, dummy: n ? la / n : 0, ground: n ? lb / n : 0 };
}, { a: a.toString("base64"), b: b.toString("base64"), discs });

// The page at the still moment, optionally with a view; the HUD hidden so only the world shows.
function pageUrl(base, view) {
  const u = new URL(base);
  u.searchParams.set("debug", "");
  u.searchParams.set("at", String(view?.at ?? AT));
  if (view?.eye) u.searchParams.set("view", [...view.eye, ...view.target].map((x) => x.toFixed(3)).join(","));
  return u.toString();
}

const frames = (p, n) => p.evaluate((n) => new Promise((done) => {
  const step = () => (--n <= 0 ? done() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

(async () => {
  const [base, out] = process.argv.slice(2);
  if (!base || !out) throw new Error("usage: node tools/look_check.cjs <base url> <out dir>");
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu"] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  let bad = false;
  const assets = new Map(); // url -> bytes
  p.on("console", (m) => {
    if (m.type() === "error") (bad = true), console.log("console error:", m.text().slice(0, 300));
    else if (m.type() === "warning") console.log("warning:", m.text().slice(0, 300));
  });
  p.on("pageerror", (e) => ((bad = true), console.log("pageerror:", e.message)));
  p.on("response", async (r) => {
    if (!new URL(r.url()).pathname.includes("/assets/")) return;
    const body = await r.body().catch(() => null);
    if (body) assets.set(r.url(), body.length);
  });
  const open = async (view) => {
    await p.goto(pageUrl(base, view));
    await p.waitForFunction(() => window.game?.world, null, { timeout: 15000 });
    await p.addStyleTag({ content: ".hud { display: none !important; }" });
  };

  await open(null);
  const world = await p.evaluate(async () => {
    const { PLAYER, LOOK, COLOURS, WEAPON_ORDER, PICKUPS } = await import(new URL("src/tuning.js", location.href));
    const { padPos } = await import(new URL("src/sim/pads.js", location.href));
    const { posesAt } = await import(new URL("src/sim/system.js", location.href));
    const { flareAt } = await import(new URL("src/sim/flares.js", location.href));
    const { flareView } = await import(new URL("src/client/look/flarepose.js", location.href));
    const w = window.game.world;
    const unit = (a) => a.map((x) => x / Math.hypot(...a)), minus = (a, b) => a.map((x, i) => x - b[i]);
    // The first comet's nearest pass by the sun in one lap.
    let comet = null;
    const cid = w.system.bodies.find((b) => b.kind === "comet").id;
    for (let t = 0; t < 80; t += 0.25) {
      const q = posesAt(w.system, t), d = Math.hypot(...minus(q[cid].pos, q.sun.pos));
      if (!comet || d < comet.d) comet = { t, d, pos: q[cid].pos, vel: q[cid].vel, sun: q.sun.pos };
    }
    // The first solar flare: its times, its main patch and where Mid is two seconds into the burn.
    const f = flareAt(0), during = posesAt(w.system, f.burnAt + 2);
    const flare = { warnAt: f.warnAt, burnAt: f.burnAt, dir: flareView(f.burnAt).dir, sun: during.sun.pos, mid: during.mid.pos };
    return {
      flare,
      bodies: w.system.bodies.map(({ id, kind, radius }) => ({ id, kind, radius })),
      poses: Object.fromEntries(Object.entries(w.poses).map(([id, q]) => [id, q.pos])),
      eye: PLAYER.eye,
      hit: PLAYER.hit,
      budget: LOOK.budget,
      levels: LOOK.quality.res.length,
      quality: LOOK.quality,
      colours: COLOURS,
      weapons: WEAPON_ORDER,
      pickups: PICKUPS.map((pk) => ({
        kind: pk.kind, body: pk.body, n: pk.dir,
        at: w.poses[pk.body].pos.map((x, i) => x + pk.dir[i] * (w.system.byId[pk.body].radius + LOOK.props.pickups.float)),
      })),
      pads: w.pads.map((pad) => {
        const at = padPos(w, pad, w.poses);
        return { body: pad.body, at, n: unit(minus(at, w.poses[pad.body].pos)) };
      }),
      comet,
    };
  });

  let frameMs = null, timed = null;
  const seen = {};
  const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
  for (const view of views(world).filter((x) => !only || only.test(x.name))) {
    await open(view);
    if (view.dummy) {
      await p.evaluate((d) => {
        const e = window.game.world.entities.dummy;
        Object.assign(e, { pos: d.pos, up: d.up, forward: d.forward, prev: null, alive: true }, d.state || {});
        // Drawn as a player of that colour (the colour is all the figure takes from it).
        if (d.as) window.game.world.players.dummy = { name: "Alien", colour: d.as };
        if (d.boost) {
          const burn = () => ((e.fuel = e.fuel > 0.1 ? e.fuel - 0.01 : 1.5), requestAnimationFrame(burn));
          burn();
        }
        if (d.fire) {
          const shoot = () => (e.shots++, requestAnimationFrame(shoot));
          shoot();
        }
      }, view.dummy);
    }
    // First person: you stand there holding the weapon (the camera is your eye).
    if (view.fp) {
      await p.evaluate((f) => {
        const e = window.game.world.entities.player;
        Object.assign(e, { pos: f.pos, up: f.up, forward: f.forward, pitch: f.pitch, prev: null, alive: true, weapon: f.weapon, groundId: "mid", vel: [0, 0, 0] });
        if (f.fire) {
          const shoot = () => (e.shots++, requestAnimationFrame(shoot));
          shoot();
        }
      }, view.fp);
    }
    if (view.shown) await p.evaluate((s) => window.game.renderer.setShown(s), view.shown);
    if (view.rock) {
      await p.evaluate(async ({ pos, vel }) => {
        const { TICK } = await import(new URL("src/tuning.js", location.href));
        const w = window.game.world, a = { id: "look-rock", pos: [...pos], vel, owner: null };
        w.asteroids.push(a);
        const fly = () => {
          for (let k = 0; k < 2; k++) (a.pos = a.pos.map((x, i) => x + vel[i] * TICK)), (w.t += TICK);
          requestAnimationFrame(fly);
        };
        fly();
      }, view.rock);
    }
    // Measured: the figure alone, its name tag hidden.
    if (SEEN.includes(view.name)) await p.evaluate(() => window.game.renderer.setShown({ tags: false }));
    await frames(p, 30); // shaders compiled, every map painted (one a frame) and a few frames drawn
    if (view.blast) {
      await p.evaluate((b) => window.game.world.explosions.push({ pos: b.pos, age: 0, splash: b.splash }), view.blast);
      await frames(p, view.blast.frames);
    }
    const file = path.join(out, `${view.name}.png`);
    const shot = await p.screenshot({ path: file });
    if (SEEN.includes(view.name)) {
      // The dummy again in each player colour (it is drawn as a player of that colour).
      const coloured = [];
      for (const colour of world.colours) {
        await p.evaluate((c) => (window.game.world.players.dummy = { name: "Alien", colour: c }), colour);
        await frames(p, 5);
        const hex = colour.toString(16).padStart(6, "0");
        coloured.push({ hex, png: await p.screenshot({ path: path.join(out, `${view.name}-${hex}.png`) }) });
      }
      await p.evaluate(() => delete window.game.world.players.dummy);
      // The same view without the dummy: what is left in its place is the ground behind it.
      await p.evaluate(() => (window.game.world.entities.dummy.alive = false));
      await frames(p, 5);
      const without = await p.screenshot({ path: path.join(out, `${view.name}-empty.png`) });
      const discs = dummyDiscs(view, world.hit);
      seen[view.name] = await contrastIn(p, shot, without, discs);
      for (const c of coloured) seen[`${view.name} ${c.hex}`] = await contrastIn(p, c.png, without, discs);
    }
    const fmt = (a) => a.map((x) => x.toFixed(1)).join(",");
    console.log(`${view.name.padEnd(14)} ${file}  ` + (view.fp ? `first person at ${fmt(view.fp.pos)}` : `eye ${fmt(view.eye)} -> ${fmt(view.target)}`));
    if (view.name === TIMED) timed = view;
  }

  // Each quality level held in the timed view, at 1080p on a 2x screen (a 1x screen draws 1 at every level).
  const big = await b.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  const q = await big.newPage();
  q.on("pageerror", (e) => ((bad = true), console.log("pageerror:", e.message)));
  if (timed) {
    for (let level = world.levels - 1; level >= 0; level--) {
      await q.goto(`${pageUrl(base, timed)}&quality=${level}`);
      await q.waitForFunction(() => window.game?.world, null, { timeout: 15000 });
      const m = await q.evaluate(() => new Promise((done) => {
        const gl = document.getElementById("game").getContext("webgl2"), px = new Uint8Array(4);
        let n = 0, work = 0, t0 = null;
        const step = (t) => {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU to finish this frame
          if (t0 === null) t0 = t; // the first frame only starts the clock
          else (n++, (work += performance.now() - t));
          if (t - t0 < 5000) return requestAnimationFrame(step);
          const c = document.getElementById("game");
          done({ ms: (t - t0) / n, work: work / n, size: `${c.width}x${c.height}`, ...window.game.renderer.stats() });
        };
        // Settle first: shaders compiled, every map painted.
        let warm = 60;
        const wait = () => (--warm > 0 ? requestAnimationFrame(wait) : requestAnimationFrame(step));
        requestAnimationFrame(wait);
      }));
      if (m.level !== level) (bad = true), console.log(`quality ${level}: drawn at level ${m.level}`);
      console.log(`quality ${level}: frame ${m.ms.toFixed(2)} ms (${(1000 / m.ms).toFixed(0)} fps), work ${m.work.toFixed(2)} ms, ` +
        `${m.calls} draw calls, ${m.triangles} triangles, drawn at ${m.size} in ${TIMED}`);
      if (level === world.levels - 1) frameMs = m.ms;
    }
  }
  if (frameMs == null && !only) (bad = true), console.log("frame time not measured");
  else if (frameMs == null) console.log("frame time not measured (views filtered)");
  else if (frameMs > 1000 / 58) console.log(`warning: the top level misses 60 fps here (${frameMs.toFixed(2)} ms); is the machine busy?`);

  // A slow machine: the live game (the clock running) with the CPU slowed 4x.
  if (!only || only.test("throttled")) {
    const live = new URL(base);
    live.searchParams.set("debug", "");
    await q.goto(live.toString());
    await q.waitForFunction(() => window.game?.world, null, { timeout: 15000 });
    await frames(q, 60);
    const cdp = await big.newCDPSession(q);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const top = world.levels - 1, t0 = Date.now(), seen = [], hold = world.quality.up + world.quality.window;
    let dropped = null, climbed = null, last = top;
    const elapsed = () => (Date.now() - t0) / 1000;
    while (dropped === null ? elapsed() < THROTTLE_DROP : elapsed() < dropped + hold) {
      await q.waitForTimeout(250);
      const { level } = await q.evaluate(() => window.game.renderer.stats());
      const t = elapsed();
      if (level !== last) seen.push(`${t.toFixed(1)} s: level ${level}`);
      if (level < top && dropped === null) dropped = t;
      if (level > last && climbed === null) climbed = t;
      last = level;
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    console.log(`throttled 4x: ${seen.join(", ") || "stayed at the top level"}, watched ${elapsed().toFixed(1)} s` +
      (dropped === null ? "" : ` (${hold} s after the first drop)`));
    if (dropped === null || dropped > THROTTLE_DROP) (bad = true), console.log(`throttled: no drop within ${THROTTLE_DROP} s`);
    if (climbed !== null) (bad = true), console.log(`throttled: climbed back at ${climbed.toFixed(1)} s`);
  }
  await b.close();
  const measured = SEEN.filter((n) => !only || only.test(n));
  for (const name of measured.flatMap((n) => [n, ...world.colours.map((c) => `${n} ${c.toString(16).padStart(6, "0")}`)])) {
    const m = seen[name];
    if (!m || !m.inside) {
      (bad = true), console.log(`${name}: the dummy is not on screen`);
      continue;
    }
    const k = Math.abs(m.dummy - m.ground), share = m.n / m.inside;
    console.log(`${name}: dummy ${m.dummy.toFixed(3)} against ground ${m.ground.toFixed(3)} over ${m.n} of ${m.inside} px ` +
      `(${(100 * share).toFixed(0)}%, at least ${100 * SEEN_SHARE}%), contrast ${k.toFixed(3)} (at least ${NIGHT_CONTRAST})`);
    if (share < SEEN_SHARE) (bad = true), console.log(`${name}: too little of the dummy differs from the ground`);
    if (k < NIGHT_CONTRAST) (bad = true), console.log(`${name}: the dummy is too hard to see on the night side`);
  }
  const bytes = [...assets.values()].reduce((a, n) => a + n, 0);
  console.log(`assets ${bytes} bytes in ${assets.size} files, budget ${world.budget}`);
  if (bytes > world.budget) (bad = true), console.log("the assets are over the budget");
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
