// Local check: loads the page with the installed Chrome, fails on any page error or console error, and
// prints the simulation clock after 5 s of real time (it must be about 5). Online (?server=...), give a
// name: it is typed into the name box, and the clock is timed once you have a body. Then it clicks the
// canvas (the click that starts sound) and plays on for a second: the sound engine must report a running,
// suspended (a headless browser may hold audio back) or disabled context, never fail the page.
// Usage: NODE_PATH=... node tools/page_check.cjs <url with ?debug> [screenshot.png] [seconds, default 5] [name]
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
  if (process.argv[5]) {
    await p.fill(".ask input", process.argv[5]);
    await p.click(".ask button");
  }
  await p.waitForFunction(() => window.game?.world, null, { timeout: 15000 }).catch(() => ((bad = true), console.log("no window.game")));
  if (process.argv[5]) {
    await p.waitForFunction(() => window.game.world.entities[window.game.world.selfId], null, { timeout: 15000 })
      .catch(() => ((bad = true), console.log("never joined")));
  }
  const t0 = await p.evaluate(() => window.game?.world.t ?? NaN);
  await p.waitForTimeout(secs * 1000);
  const t = await p.evaluate(() => window.game?.world.t ?? NaN);
  console.log(`world.t ${t.toFixed(2)} (advanced ${(t - t0).toFixed(2)} in ${secs} s)`);
  if (!(Math.abs(t - t0 - secs) < 0.25 * secs)) (bad = true), console.log("the clock did not keep up with real time");
  await p.click("#game");
  await p.waitForTimeout(1000);
  const sound = await p.evaluate(() => window.game?.audio?.state?.() ?? "missing");
  console.log(`sound ${sound}`);
  if (!["running", "suspended", "disabled"].includes(sound)) (bad = true), console.log("the click did not start the sound engine");
  if (process.argv[3]) {
    require("fs").mkdirSync(require("path").dirname(process.argv[3]), { recursive: true });
    await p.screenshot({ path: process.argv[3] });
  }
  await b.close();
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
