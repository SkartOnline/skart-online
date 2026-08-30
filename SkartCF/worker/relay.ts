import { DurableObject } from "cloudflare:workers";
import { Relay } from "../src/net/relayCore";
import type { RelayClient } from "../src/net/relayCore";
import type { ClientFrame } from "../src/net/protocol";

/**
 * The matchmaking relay, as a Cloudflare Worker.
 *
 * The third shell around the same `Relay`: `loopback.ts` wires it up in-process
 * for the suite, `server/relay.ts` puts a node socket on it for local work and
 * `npm run smoke`, and this puts it on Cloudflare so two friends on two
 * machines can reach it without anybody paying for a server.
 *
 * The bookkeeping is not repeated here, and that is the point — a matchmaking
 * bug that only reproduces against a deployed server is a bad afternoon, so
 * `src/net/match.test.ts` drives the same class this file wraps.
 *
 * Note what does *not* end up in the bundle: `protocol.ts` reaches for the
 * engine's types with `import type`, which esbuild erases, so the deployed
 * Worker contains no card, no rule and no reducer. The invariant survives the
 * port intact.
 *
 *     npm run relay:dev       # locally, on wrangler
 *     npm run relay:deploy    # to the account you are logged into
 */

/** Every room in one Durable Object. Two friends do not need to be sharded. */
const ONE_RELAY = "skart";

/** A room whose code was never used is not a room. Swept on this cadence. */
const SWEEP_MS = 5 * 60 * 1000;

/**
 * Nothing a client can say is bigger than an action, and an action is a few
 * hundred bytes. Cloudflare caps an incoming message at 1 MB of its own accord;
 * this is the cheaper refusal, made before we hand anything to `JSON.parse`.
 */
const MAX_FRAME = 256 * 1024;

/** `WebSocket.OPEN`, spelled out because the Workers socket is not the DOM one. */
const OPEN = 1;

interface Env {
  RELAY: DurableObjectNamespace;
}

export class RelayRoom extends DurableObject {
  private relay = new Relay();
  /**
   * The relay keys its seats on client identity, so each socket has to hand
   * back the same object every time it speaks.
   */
  private seats = new Map<WebSocket, RelayClient>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Every host wants a health check, and one that only speaks WebSocket fails
    // all of them.
    if (url.pathname === "/health") {
      return Response.json({ ok: true, rooms: this.relay.roomCount });
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    // `accept()` rather than the hibernation API: hibernation lets the object
    // fall out of memory, and everything the relay knows — which code is live,
    // who is sitting in it — is in memory. Waking up empty would drop rooms
    // mid-match. Holding the object resident instead costs duration only while
    // somebody is actually connected, and a 128 MB object burns about 3% of the
    // free plan's daily allowance even if it were connected around the clock.
    server.accept();

    const seat: RelayClient = {
      send: (frame) => {
        if (server.readyState === OPEN) server.send(JSON.stringify(frame));
      },
    };
    this.seats.set(server, seat);

    server.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data.length > MAX_FRAME) return;
      let frame: ClientFrame;
      try {
        frame = JSON.parse(event.data) as ClientFrame;
      } catch {
        // Not our protocol. Say nothing and keep the socket: a garbled frame is
        // more likely a bug at the other end than an attack, and dropping the
        // connection would take the room down with it.
        return;
      }
      if (!frame || typeof frame.t !== "string") return;
      try {
        this.relay.receive(seat, frame);
      } catch (e) {
        console.error("[relay]", e);
      }
    });

    // Both doors lead to the same place: whoever was in the other chair is
    // told, and an empty room is forgotten. The node build needs a ping/pong
    // heartbeat to notice a laptop whose lid went down; Cloudflare's edge
    // notices for us and fires close, so there is no timer here.
    const gone = () => {
      this.relay.leave(seat);
      this.seats.delete(server);
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);

    await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Drops rooms whose code was never used, then rearms itself if any remain. */
  async alarm(): Promise<void> {
    this.relay.sweep();
    if (this.relay.roomCount > 0) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.RELAY.get(env.RELAY.idFromName(ONE_RELAY)).fetch(request);
  },
};
