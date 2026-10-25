// Local check: loads the page with the installed Chrome, fails on any page error or console error, and
// prints the simulation clock after 5 s of real time (it must be about 5).
// Usage: NODE_PATH=... node tools/page_check.cjs <url with ?debug> [screenshot.png] [seconds, default 5]
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  let bad = false;
  p.on("console", (m) => {
    if (m.type() === "error") (bad = true), console.log("console error:", m.text().slice(0, 300));
    else if (m.type() === "warning") console.log("warning:", m.text().slice(0, 300));
  });
  p.on("pageerror", (e) => ((bad = true), console.log("pageerror:", e.message)));
  await p.goto(process.argv[2]);
  const secs = Number(process.argv[4] || 5);
  await p.waitForFunction(() => window.game?.world, null, { timeout: 15000 }).catch(() => ((bad = true), console.log("no window.game")));
  const t0 = await p.evaluate(() => window.game?.world.t ?? NaN);
  await p.waitForTimeout(secs * 1000);
  const t = await p.evaluate(() => window.game?.world.t ?? NaN);
  console.log(`world.t ${t.toFixed(2)} (advanced ${(t - t0).toFixed(2)} in ${secs} s)`);
  if (!(Math.abs(t - t0 - secs) < 0.25 * secs)) (bad = true), console.log("the clock did not keep up with real time");
  if (process.argv[3]) {
    require("fs").mkdirSync(require("path").dirname(process.argv[3]), { recursive: true });
    await p.screenshot({ path: process.argv[3] });
  }
  await b.close();
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
