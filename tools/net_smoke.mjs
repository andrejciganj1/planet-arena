// Two clients against a running server (node server/server.js): both must get a welcome and a snapshot
// that lists two players. Prints OK, or the reason and exit code 1.
const URL = process.env.URL || "ws://localhost:8787";
const fail = (why) => { console.log(why); process.exit(1); };
setTimeout(() => fail("timeout"), 8000).unref();

function client(name) {
  return new Promise((resolve, reject) => {
    const c = { welcome: null, twoPlayers: false };
    const ws = new WebSocket(URL);
    ws.onerror = () => reject(new Error(`${name}: connection error`));
    ws.onclose = () => { if (!c.welcome) reject(new Error(`${name}: closed before welcome`)); };
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", v: 1, name }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "welcome") {
        c.welcome = m;
        const first = m.tick;
        for (let i = 1; i <= 60; i++) {
          ws.send(JSON.stringify({ type: "input", tick: first + i, view: first + i - 6, input: { move: [0, 0] } }));
        }
      } else if (m.type === "snap" && Object.keys(m.players).length === 2) {
        c.twoPlayers = true;
        resolve({ ws, c });
      } else if (m.type === "full" || m.type === "version") reject(new Error(`${name}: got ${m.type}`));
    };
  });
}

try {
  const [a, b] = await Promise.all([client("A"), client("B")]);
  if (!a.c.welcome || !b.c.welcome) fail("missing welcome");
  a.ws.close();
  b.ws.close();
  console.log("OK");
  process.exit(0);
} catch (e) {
  fail(e.message);
}
