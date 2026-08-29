import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { Relay } from "../src/net/relayCore";
import type { ClientFrame } from "../src/net/protocol";

/**
 * The matchmaking relay.
 *
 * It pairs two clients by a six-digit code and forwards bytes between them.
 * That is the whole job. It does not import the engine, does not know what a
 * card is, holds no game state and has no database — so it is deployed once
 * and then has no reason to be touched again by anything short of a protocol
 * change. A new card, a new effect kind, a rebalance: none of it reaches here.
 *
 * The bookkeeping lives in `src/net/relayCore.ts` and is covered by
 * `src/net/match.test.ts`, which drives this same class in-process. What is
 * left in this file is sockets and signals.
 *
 *     npm run relay              # port 8787, or $PORT
 *
 * Any host that runs Node and terminates TLS will do. In front of it the client
 * needs `VITE_RELAY_URL=wss://…` at build time; see `README.md`.
 */

const PORT = Number(process.env.PORT ?? 8787);
/** A room whose code was never used is not a room. Swept on this cadence. */
const SWEEP_MS = 5 * 60 * 1000;
/**
 * Nothing a client can say is bigger than an action, and an action is a few
 * hundred bytes. The cap is three orders of magnitude above that and exists so
 * that a client which is not one of ours cannot make the process buy memory by
 * the megabyte.
 */
const MAX_FRAME = 256 * 1024;

const relay = new Relay();

/**
 * A plain HTTP endpoint alongside the socket.
 *
 * Every free host wants a health check, and one that only speaks WebSocket
 * fails all of them.
 */
const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: relay.roomCount }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME });

wss.on("connection", (socket: WebSocket) => {
  const client = {
    send(frame: unknown) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    },
  };

  socket.on("message", (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(String(raw)) as ClientFrame;
    } catch {
      // Not our protocol. Say nothing and keep the socket: a garbled frame is
      // more likely a bug at the other end than an attack, and dropping the
      // connection would take the room down with it.
      return;
    }
    if (!frame || typeof frame.t !== "string") return;
    try {
      relay.receive(client, frame);
    } catch (e) {
      console.error("[relay]", e);
    }
  });

  // Both doors lead to the same place: whoever was in the other chair is told,
  // and an empty room is forgotten.
  socket.on("close", () => relay.leave(client));
  socket.on("error", () => relay.leave(client));
});

/**
 * Sockets that have stopped answering.
 *
 * A browser tab that is closed sends a close frame; a laptop whose lid goes
 * down does not, and without this its half of the room would sit there forever
 * looking present to the player still waiting for it.
 */
const alive = new WeakSet<WebSocket>();
wss.on("connection", (socket: WebSocket) => {
  alive.add(socket);
  socket.on("pong", () => alive.add(socket));
});
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, 30_000);

const sweeper = setInterval(() => {
  const dropped = relay.sweep();
  if (dropped) console.log(`[relay] swept ${dropped} unused room(s)`);
}, SWEEP_MS);

http.listen(PORT, () => console.log(`[relay] listening on :${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    wss.close();
    http.close(() => process.exit(0));
  });
}
