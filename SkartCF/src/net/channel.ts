import type { ClientFrame, ServerFrame } from "./protocol";
import { Relay } from "./relayCore";
import type { RelayClient } from "./relayCore";
import { connectorOver } from "./link";
import type { FrameLink } from "./link";
import type { Connector } from "./room";

/**
 * Two tabs of one browser, with no server anywhere.
 *
 * The same `Relay` again, this time with a `BroadcastChannel` where the sockets
 * would be. The tab that creates a room *is* the relay for that room: it holds
 * the `Relay` instance, and any tab that joins is talking to it across the
 * channel. Nothing is listening on a port and nothing has been deployed.
 *
 * This is how the whole feature was built and is still the fastest way to see
 * it work — open the game twice, create in one tab, paste the code into the
 * other. It is a real match, played by the real code, over a transport that
 * happens to be four inches long.
 *
 * What it is not is a way to play with somebody else, since a `BroadcastChannel`
 * reaches no further than one browser profile on one machine. That is what
 * `socket.ts` and the relay in `server/` are for.
 */

const CHANNEL = "skartcf.rooms.v1";

/** A frame with an envelope: which room, which client, and which way it is going. */
type Post =
  | { dir: "up"; room: string | null; client: string; frame: ClientFrame }
  | { dir: "down"; client: string; frame: ServerFrame }
  /** Asked by a joining tab: does anybody own this code? */
  | { dir: "seek"; room: string; client: string }
  | { dir: "gone"; client: string };

const nonce = (): string => Math.random().toString(36).slice(2, 10);

/** How long a joining tab waits for an owner to answer before giving up. */
const SEEK_MS = 1200;

export function channelConnector(): Connector | null {
  if (typeof BroadcastChannel === "undefined") return null;

  const bus = new BroadcastChannel(CHANNEL);
  /** Rooms this tab owns, and the relay serving them. */
  const relay = new Relay();
  const owned = new Set<string>();
  /** The far side of each client this tab is relaying for. */
  const guests = new Map<string, RelayClient>();

  const say = (post: Post) => bus.postMessage(post);

  /**
   * The host tab's ear.
   *
   * Two jobs: answer `seek` for codes it owns, and pump anything addressed to
   * one of its rooms through the relay. A tab that owns nothing does neither,
   * so every tab can run this listener and only the right one ever replies.
   */
  bus.addEventListener("message", (event: MessageEvent<Post>) => {
    const post = event.data;
    if (post.dir === "seek") {
      if (owned.has(post.room)) say({ dir: "down", client: post.client, frame: { t: "peer", present: true } });
      return;
    }
    if (post.dir === "gone") {
      const client = guests.get(post.client);
      if (!client) return;
      guests.delete(post.client);
      relay.leave(client);
      return;
    }
    if (post.dir !== "up") return;
    // A join names the room in the frame; everything after it is addressed by
    // the client id we already know.
    const code = post.frame.t === "join" ? post.frame.code : post.room;
    if (code && !owned.has(code)) return;
    if (!code && !guests.has(post.client)) return;

    let client = guests.get(post.client);
    if (!client) {
      client = { send: (frame) => say({ dir: "down", client: post.client, frame }) };
      guests.set(post.client, client);
    }
    relay.receive(client, post.frame);
  });

  const link = (mine: string | null): FrameLink => {
    const client = nonce();
    let onFrame: (f: ServerFrame) => void = () => {};
    let onClosed: (reason: string) => void = () => {};
    let room: string | null = mine;
    let live = true;

    const ear = (event: MessageEvent<Post>) => {
      const post = event.data;
      if (post.dir !== "down" || post.client !== client || !live) return;
      if (post.frame.t === "open") room = post.frame.code;
      onFrame(post.frame);
    };
    bus.addEventListener("message", ear);

    return {
      send(frame) {
        if (live) say({ dir: "up", room, client, frame });
      },
      close() {
        if (!live) return;
        live = false;
        say({ dir: "gone", client });
        bus.removeEventListener("message", ear);
        onClosed("closed");
      },
      onFrame(handler) {
        onFrame = handler;
      },
      onClosed(handler) {
        onClosed = handler;
      },
    };
  };

  return {
    /**
     * Creating never leaves the tab: the room is made in the local relay, and
     * this tab becomes the thing that serves it.
     */
    async create() {
      const local: FrameLink = (() => {
        const client = nonce();
        let onFrame: (f: ServerFrame) => void = () => {};
        let onClosed: (reason: string) => void = () => {};
        let live = true;
        const me: RelayClient = { send: (frame) => live && onFrame(frame) };
        guests.set(client, me);
        return {
          send(frame) {
            if (!live) return;
            relay.receive(me, frame);
          },
          close() {
            if (!live) return;
            live = false;
            for (const code of owned) owned.delete(code);
            guests.delete(client);
            relay.leave(me);
            onClosed("closed");
          },
          onFrame(handler) {
            onFrame = (frame) => {
              if (frame.t === "open") owned.add(frame.code);
              handler(frame);
            };
          },
          onClosed(handler) {
            onClosed = handler;
          },
        };
      })();
      const { create } = connectorOver(() => local);
      return create();
    },

    /**
     * Joining asks the other tabs first.
     *
     * Without the `seek`, a code with no owner would simply produce silence,
     * and the player would sit in front of a spinner that never resolves. This
     * turns "nobody answered" into the same refusal a real relay would send.
     */
    async join(code) {
      const answered = await new Promise<boolean>((resolve) => {
        const probe = nonce();
        const timer = setTimeout(() => {
          bus.removeEventListener("message", ear);
          resolve(false);
        }, SEEK_MS);
        const ear = (event: MessageEvent<Post>) => {
          const post = event.data;
          if (post.dir !== "down" || post.client !== probe) return;
          clearTimeout(timer);
          bus.removeEventListener("message", ear);
          resolve(true);
        };
        bus.addEventListener("message", ear);
        say({ dir: "seek", room: code, client: probe });
      });
      if (!answered) throw new Error("Nincs ilyen szoba ebben a böngészőben.");
      const { join } = connectorOver(() => link(code));
      return join(code);
    },
  };
}
