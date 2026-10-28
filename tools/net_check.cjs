// Two-browser check: two pages join the same server, each types a name and plays. Prints OK when both
// views hold two players, neither has a page error, and each view's clock keeps real time.
// Needs both servers up (python3 -I tools/serve.py 8100, node server/server.js).
// Usage: NODE_PATH=... node tools/net_check.cjs "http://localhost:8100/?server=ws://localhost:8787&debug" [shots dir]
const { chromium } = require("playwright");
const SECS = 5;
(async () => {
  const url = process.argv[2];
  const dir = process.argv[3] || "shots";
  if (!url) throw new Error("usage: net_check.cjs <page url with ?server=...&debug> [shots dir]");
  const b = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu"] });
  let bad = false;
  const open = async (name) => {
    // A separate context each, so the two players do not share the stored name or token.
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on("console", (m) => {
      if (m.type() === "error") (bad = true), console.log(`${name} console error:`, m.text().slice(0, 300));
    });
    p.on("pageerror", (e) => ((bad = true), console.log(`${name} pageerror:`, e.message)));
    await p.goto(url);
    await p.fill(".ask input", name);
    await p.click(".ask button");
    await p.waitForFunction(() => window.game?.world?.entities[window.game.world.selfId], null, { timeout: 15000 })
      .catch(() => ((bad = true), console.log(`${name} never joined`)));
    return p;
  };
  const pages = [await open("Ana"), await open("Bo")];
  const players = (p) => p.evaluate(() => {
    const w = window.game.world;
    return Object.values(w.entities).filter((e) => e.kind === "player").length;
  });
  await Promise.all(pages.map((p) => p.waitForFunction(() => {
    const w = window.game.world;
    return Object.values(w.entities).filter((e) => e.kind === "player").length >= 2;
  }, null, { timeout: 15000 }).catch(() => {})));
  const t0 = await Promise.all(pages.map((p) => p.evaluate(() => window.game.world.t)));
  await pages[0].waitForTimeout(SECS * 1000);
  for (const [i, p] of pages.entries()) {
    const t = await p.evaluate(() => window.game.world.t);
    const n = await players(p);
    console.log(`page ${i + 1}: ${n} players, world.t advanced ${(t - t0[i]).toFixed(2)} in ${SECS} s`);
    if (n !== 2) (bad = true), console.log(`page ${i + 1} should see two players`);
    if (!(Math.abs(t - t0[i] - SECS) < 0.25 * SECS)) (bad = true), console.log(`page ${i + 1} clock did not keep up`);
    require("fs").mkdirSync(dir, { recursive: true });
    await p.screenshot({ path: require("path").join(dir, `net_${i + 1}.png`) });
  }
  await b.close();
  console.log(bad ? "FAIL" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
