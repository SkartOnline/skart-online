import type { RoomMessage, RoomSeat } from "./protocol";

/**
 * A room, as the game sees it: a code, which chair you are in, whether anybody
 * is in the other one, and a way to say things to them.
 *
 * Everything above this line — the lobby, the match, the screen — talks only to
 * this. Everything below it is transport: an in-process fake for the tests, a
 * `BroadcastChannel` for two tabs of one browser, a WebSocket for two people in
 * two houses. Swapping one for another is one line at the call site, which is
 * the only reason it was possible to build and test the whole feature before
 * there was a server to run it against.
 */
export interface Room {
  readonly code: string;
  readonly seat: RoomSeat;
  /** Is somebody sitting in the other chair right now? */
  readonly peerPresent: boolean;
  send(message: RoomMessage): void;
  /** Returns its own unsubscriber, so a React effect can hand it straight back. */
  onMessage(handler: (message: RoomMessage) => void): () => void;
  onPeer(handler: (present: boolean) => void): () => void;
  onClosed(handler: (reason: string) => void): () => void;
  close(): void;
}

/** How a room is obtained. Six digits out, or six digits in. */
export interface Connector {
  create(): Promise<Room>;
  join(code: string): Promise<Room>;
}
