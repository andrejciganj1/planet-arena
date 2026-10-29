// Look check: screenshots of a fixed list of views with the match clock standing still (?at), so two runs
// can be compared pixel for pixel. Views are worked out from the world itself: each planet from afar and
// standing on its day and night side, a moon and a comet from afar, the sun, the sky, and the dummy on the
// tiny planet's night side seen from 30 m. Also measures the average frame time over 5 s in one view and
// sums the bytes of every file under assets/ the page fetched. Prints one line per view, then OK when there
// were no page errors, the frame time was measured and the assets fit in LOOK.budget.
// Usage: NODE_PATH=... node tools/look_check.cjs <base url, e.g. http://localhost:8100/> <out dir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AT = 40; // s on the match clock for every view
const TIMED = "mid-day"; // the view whose frame time is measured

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
    name: "dummy-night",
    eye: v.add(pos, v.scale(v.norm(v.add(up, v.scale(across, 0.5))), 30)),
    target: v.add(pos, v.scale(up, 1)),
    dummy: { pos, up, forward },
  });
  return list;
}

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
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
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
      budget: LOOK.budget,
    };
  });

  let frameMs = null;
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
    await p.screenshot({ path: file });
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
  const bytes = [...assets.values()].reduce((a, n) => a + n, 0);
  console.log(`assets ${bytes} bytes in ${assets.size} files, budget ${world.budget}`);
  if (bytes > world.budget) (bad = true), console.log("the assets are over the budget");
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
