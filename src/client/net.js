// The WebSocket to the game server. It never gives up: a server asleep on Fly.io takes a few seconds to
// wake, and one restarted or redeployed comes back, so it retries every 1 to 2 s and says hello again on
// every open (the token in the hello makes a quick return the same player).
import { NET } from "../tuning.js";

// Statuses: "connecting", "open", "unreachable" (still trying, but for NET.unreachable s now) and
// "closed" (close() was called). `hello` gives the message to send on each open.
export function connect(url, { hello, onMessage, onStatus }) {
  let ws = null, timer = null, closed = false;
  let failingSince = null; // when the current run of failed tries began
  const now = () => performance.now() / 1000;
  const trying = () => onStatus(failingSince !== null && now() - failingSince >= NET.unreachable ? "unreachable" : "connecting");

  function retry() {
    ws = null;
    if (closed) return;
    failingSince ??= now();
    trying();
    timer = setTimeout(open, 1000 + Math.random() * 1000);
  }

  function open() {
    trying();
    try {
      ws = new WebSocket(url);
    } catch {
      retry(); // a malformed address throws at once
      return;
    }
    ws.onopen = () => {
      failingSince = null;
      onStatus("open");
      ws.send(JSON.stringify(hello()));
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      onMessage(msg);
    };
    ws.onclose = retry; // an error is always followed by a close
  }

  open();
  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
      onStatus("closed");
    },
  };
}
