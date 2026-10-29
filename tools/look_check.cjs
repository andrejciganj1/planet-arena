// Look check: screenshots of a fixed list of views with the match clock standing still (?at), so two runs
// can be compared pixel for pixel. Views are worked out from the world itself: each planet from afar and
// standing on its day and night side, a moon and a comet from afar, the sun, the sky, and the dummy on a night
// side seen from 30 m (the tiny planet, and the heavy one from inside its shadow, where the planet hides the
// whole sun so no glow brightens the screen). In that last view the dummy must stand out from the ground
// behind it: the mean brightness of its pixels and of the same pixels without it (the ground) differ by at
// least NIGHT_CONTRAST of full scale. Also measures the average frame time over 5 s in one view and sums the
// bytes of every file under assets/ the page fetched. Prints one line per view, then OK when there were no
// page errors, the dummy was seen, the frame time was measured and the assets fit in LOOK.budget.
// Usage: NODE_PATH=... node tools/look_check.cjs <base url, e.g. http://localhost:8100/> <out dir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AT = 40; // s on the match clock for every view
const TIMED = "mid-day"; // the view whose frame time is measured
const SEEN = "dummy-night"; // the view whose dummy must stand out
const NIGHT_CONTRAST = 0.06; // of full scale (sRGB luminance), dummy against the ground behind it
const FOV = 80, W = 1280, H = 800; // the camera and the window

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
function views({ bodies, poses, eye: eyeHeight }) {
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
  // The dummy at the heavy planet's midnight, seen from 30 m at 55 degrees above its horizon. The eye stays
  // inside the planet's shadow (17 m off its axis, radius 23), so the planet hides the whole sun.
  const heavy = bodies.find((b) => b.id === "heavy"), hc = poses.heavy, hs = v.norm(v.sub(sun, hc));
  const hup = v.scale(hs, -1), hpos = v.add(hc, v.scale(hup, heavy.radius));
  const hacross = v.norm(v.cross(Y, hs)), hforward = v.norm(v.cross(hacross, hup)), el = (55 * Math.PI) / 180;
  list.push({
    name: "dummy-night",
    eye: v.add(hpos, v.scale(v.add(v.scale(hup, Math.sin(el)), v.scale(hacross, Math.cos(el))), 30)),
    target: v.add(hpos, v.scale(hup, 1)),
    dummy: { pos: hpos, up: hup, forward: hforward },
  });
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
// in each, and how many there are.
const contrastIn = (p, a, b, discs) => p.evaluate(async ({ a, b, discs }) => {
  const pixels = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  };
  const A = await pixels(a), B = await pixels(b);
  const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  let n = 0, la = 0, lb = 0;
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    if (!discs.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r)) continue;
    const i = 4 * (y * A.width + x);
    if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) < 6) continue;
    n++, (la += lum(A.data, i)), (lb += lum(B.data, i));
  }
  return { n, dummy: n ? la / n : 0, ground: n ? lb / n : 0 };
}, { a: a.toString("base64"), b: b.toString("base64"), discs });

// The page at the still moment, optionally with a view; the HUD hidden so only the world shows.
function pageUrl(base, view) {
  const u = new URL(base);
  u.searchParams.set("debug", "");
  u.searchParams.set("at", String(AT));
  if (view) u.searchParams.set("view", [...view.eye, ...view.target].map((x) => x.toFixed(3)).join(","));
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
    const { PLAYER, LOOK } = await import(new URL("src/tuning.js", location.href));
    const w = window.game.world;
    return {
      bodies: w.system.bodies.map(({ id, kind, radius }) => ({ id, kind, radius })),
      poses: Object.fromEntries(Object.entries(w.poses).map(([id, q]) => [id, q.pos])),
      eye: PLAYER.eye,
      hit: PLAYER.hit,
      budget: LOOK.budget,
    };
  });

  let frameMs = null, seen = null;
  for (const view of views(world)) {
    await open(view);
    if (view.dummy) {
      await p.evaluate((d) => {
        const e = window.game.world.entities.dummy;
        Object.assign(e, { pos: d.pos, up: d.up, forward: d.forward, prev: null, alive: true });
      }, view.dummy);
    }
    await frames(p, 30); // shaders compiled and a few frames drawn
    const file = path.join(out, `${view.name}.png`);
    const shot = await p.screenshot({ path: file });
    if (view.name === SEEN) {
      // The same view without the dummy: what is left in its place is the ground behind it.
      await p.evaluate(() => (window.game.world.entities.dummy.alive = false));
      await frames(p, 5);
      const without = await p.screenshot({ path: path.join(out, `${view.name}-empty.png`) });
      seen = await contrastIn(p, shot, without, dummyDiscs(view, world.hit));
    }
    const fmt = (a) => a.map((x) => x.toFixed(1)).join(",");
    console.log(`${view.name.padEnd(14)} ${file}  eye ${fmt(view.eye)} -> ${fmt(view.target)}`);
    if (view.name === TIMED) {
      frameMs = await p.evaluate(() => new Promise((done) => {
        let n = 0;
        const t0 = performance.now();
        const step = (t) => (++n, t - t0 < 5000 ? requestAnimationFrame(step) : done((t - t0) / n));
        requestAnimationFrame(step);
      }));
    }
  }
  await b.close();

  if (frameMs == null) (bad = true), console.log("frame time not measured");
  else console.log(`frame time ${frameMs.toFixed(2)} ms average over 5 s in ${TIMED} (${(1000 / frameMs).toFixed(0)} fps)`);
  if (!seen || !seen.n) (bad = true), console.log(`${SEEN}: the dummy was not found on screen`);
  else {
    const k = Math.abs(seen.dummy - seen.ground);
    console.log(`${SEEN}: dummy ${seen.dummy.toFixed(3)} against ground ${seen.ground.toFixed(3)} over ${seen.n} px, contrast ${k.toFixed(3)} (at least ${NIGHT_CONTRAST})`);
    if (k < NIGHT_CONTRAST) (bad = true), console.log("the dummy is too hard to see on the night side");
  }
  const bytes = [...assets.values()].reduce((a, n) => a + n, 0);
  console.log(`assets ${bytes} bytes in ${assets.size} files, budget ${world.budget}`);
  if (bytes > world.budget) (bad = true), console.log("the assets are over the budget");
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
