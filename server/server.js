// The server process: WebSockets in, the game room's ticks out. All rules live in game.js; this file only
// owns sockets and the clock. Logs hold counts only, never names.
import { WebSocketServer } from "ws";
import * as tuning from "../src/tuning.js";
import { createGame } from "./game.js";

const { TICK, MAX_TICKS } = tuning;
const port = Number(process.env.PORT) || 8787;
const game = createGame(tuning);
const wss = new WebSocketServer({ port, host: "0.0.0.0", maxPayload: 4096 }); // inputs are tiny; a big frame is abuse
const sockets = new Map(); // conn -> ws, for those the game accepted
let nextConn = 1;
// A socket can die without a close (a laptop sleeps, Wi-Fi changes): its player would stand frozen for
// minutes and snapshots pile up in memory. Every socket is pinged; one silent for PONG_WAIT is cut, and so
// is one that has stopped taking what is sent (MAX_BUFFERED is several seconds of 8 players' snapshots).
const PING_EVERY = 2000, PONG_WAIT = 5000, MAX_BUFFERED = 1 << 20; // ms, ms, bytes

const send = (ws, msg) => {
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED) ws.terminate();
  else ws.send(JSON.stringify(msg));
};

wss.on("listening", () => console.log(`planet-arena server listening on port ${port}`));

wss.on("connection", (ws) => {
  const conn = nextConn++;
  ws.heardAt = Date.now();
  ws.on("pong", () => (ws.heardAt = Date.now()));
  ws.on("message", (data) => {
    // One bad message must never take the server down, whatever game.js does with it.
    try {
      handle(data);
    } catch {
      console.log("handler error");
    }
  });
  function handle(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "hello") {
      const { replaced, ...reply } = game.hello(conn, msg);
      send(ws, reply);
      if (reply.type === "welcome") {
        // The same page on a new socket took its player over: the old socket goes quietly, no leave.
        if (replaced !== undefined) {
          const old = sockets.get(replaced);
          sockets.delete(replaced); // first, so its close finds nothing to drop
          old?.terminate();
        } else if (!sockets.has(conn)) console.log(`join: ${sockets.size + 1} players`);
        sockets.set(conn, ws);
      } else {
        ws.close(); // full or wrong version: nothing more to say
      }
    } else if (msg.type === "input") {
      game.input(conn, msg);
    }
  }
  const gone = () => {
    if (!sockets.delete(conn)) return;
    game.drop(conn);
    console.log(`leave: ${sockets.size} players`);
  };
  ws.on("close", gone);
  ws.on("error", gone);
});

setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (now - ws.heardAt > PONG_WAIT) ws.terminate(); // its close event drops the player
    else if (ws.readyState === ws.OPEN) ws.ping();
  }
}, PING_EVERY);

// Real elapsed time becomes ticks as in sim's advance, but each tick goes through game.step() and its
// snapshots are sent. After a stall, ticks beyond MAX_TICKS are dropped rather than caught up.
let last = performance.now() / 1000;
let acc = 0;
function loop() {
  setTimeout(loop, 4); // scheduled first so a throw below can never stop the clock
  try {
    const now = performance.now() / 1000;
    acc += now - last;
    last = now;
    let n = Math.floor(acc / TICK + 1e-9);
    if (n > MAX_TICKS) {
      n = MAX_TICKS;
      acc = n * TICK;
    }
    for (let i = 0; i < n; i++) {
      acc -= TICK;
      for (const { conn, msg } of game.step()) {
        const ws = sockets.get(conn);
        if (ws) send(ws, msg);
      }
    }
    acc = Math.max(0, acc);
  } catch {
    console.log("tick error");
  }
}
loop();

const stop = () => {
  wss.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
