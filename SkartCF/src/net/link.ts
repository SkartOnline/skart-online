import type { ClientFrame, RelayError, RoomMessage, ServerFrame } from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";
import type { Connector, Room } from "./room";

/**
 * The seam every transport meets.
 *
 * A link is a duplex of frames and nothing else: no notion of rooms, codes or
 * players. Give one of these and the handshake, the subscriber bookkeeping and
 * the peer tracking below are free — which is why the in-process relay, the
 * two-tab channel and the real socket are each about forty lines.
 */
export interface FrameLink {
  send(frame: ClientFrame): void;
  close(): void;
  onFrame(handler: (frame: ServerFrame) => void): void;
  onClosed(handler: (reason: string) => void): void;
}

const EXCUSE: Record<RelayError, string> = {
  "no-such-room": "Nincs ilyen szoba. Lehet, hogy elgépelted, vagy már bezárt.",
  "room-full": "Ez a szoba tele van. Kettőnél többen nem férnek el.",
  "bad-version": "A két gép nem ugyanazt a változatot futtatja. Töltsd újra az oldalt.",
  "bad-code": "A kód hat számjegy.",
};

export const excuseFor = (reason: RelayError): string => EXCUSE[reason];

/**
 * Runs the handshake and hands back a room.
 *
 * Rejects rather than resolving into a broken room: a lobby with no code is not
 * a lobby, and the screen that called this has a perfectly good place to put an
 * error message.
 */
export function openRoom(link: FrameLink, request: ClientFrame): Promise<Room> {
  return new Promise((resolve, reject) => {
    const messageHandlers = new Set<(m: RoomMessage) => void>();
    const peerHandlers = new Set<(present: boolean) => void>();
    const closedHandlers = new Set<(reason: string) => void>();
    let settled = false;
    let peerPresent = false;

    let room: Room | null = null;

    link.onFrame((frame) => {
      if (frame.t === "error") {
        const excuse = excuseFor(frame.reason);
        if (!settled) {
          settled = true;
          link.close();
          reject(new Error(excuse));
        } else {
          for (const h of closedHandlers) h(excuse);
        }
        return;
      }

      if (frame.t === "open") {
        if (settled) return;
        settled = true;
        peerPresent = frame.peer;
        room = {
          code: frame.code,
          seat: frame.seat,
          get peerPresent() {
            return peerPresent;
          },
          send: (message) => link.send({ t: "post", body: message }),
          onMessage(handler) {
            messageHandlers.add(handler);
            return () => messageHandlers.delete(handler);
          },
          onPeer(handler) {
            peerHandlers.add(handler);
            return () => peerHandlers.delete(handler);
          },
          onClosed(handler) {
            closedHandlers.add(handler);
            return () => closedHandlers.delete(handler);
          },
          close: () => link.close(),
        };
        resolve(room);
        return;
      }

      if (frame.t === "peer") {
        peerPresent = frame.present;
        for (const h of peerHandlers) h(frame.present);
        return;
      }

      // Handlers are copied before the walk: a subscriber that unsubscribes on
      // the message it receives — which the match does, on `bye` — would
      // otherwise mutate the set mid-iteration.
      for (const h of [...messageHandlers]) h(frame.body);
    });

    link.onClosed((reason) => {
      if (!settled) {
        settled = true;
        reject(new Error(reason));
        return;
      }
      for (const h of closedHandlers) h(reason);
    });

    link.send(request);
  });
}

/** Turns any way of making links into the `Connector` the lobby wants. */
export function connectorOver(open: () => FrameLink | Promise<FrameLink>): Connector {
  return {
    async create() {
      return openRoom(await open(), { t: "create", v: PROTOCOL_VERSION });
    },
    async join(code) {
      return openRoom(await open(), { t: "join", v: PROTOCOL_VERSION, code });
    },
  };
}
