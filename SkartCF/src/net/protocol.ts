import type { Action, CardSet, GameState, PlayerId } from "../engine";

/**
 * The wire.
 *
 * Two conversations happen over one socket and they know nothing about each
 * other. The *frames* are addressed to the relay: make me a room, put me in
 * that room, pass this along. The *room messages* are addressed to the other
 * player, and the relay forwards them without reading them — it has no copy of
 * the engine, no card set, and no opinion about whether a move is legal.
 *
 * That split is the whole reason the relay can be deployed once and then left
 * alone. A new card, a new effect kind, a new rule: none of it reaches the
 * server, because the server has never heard of Skart.
 */

/** Bumped when a frame or room message changes shape. Old clients are refused. */
export const PROTOCOL_VERSION = 1;

/** Which end of the room somebody is. The host holds the truth; see `match.ts`. */
export type RoomSeat = "host" | "guest";

/**
 * Seats are fixed rather than drawn for.
 *
 * There is nothing to win by drawing: who moves first is `ordered[0].broughtBy`,
 * which the shuffle in `createGame` decides, so p1 is not an advantage. Fixing
 * it means a reconnect knows which chair it is coming back to without asking.
 */
export const SEAT_OF: Record<RoomSeat, PlayerId> = { host: "p1", guest: "p2" };

export type RelayError =
  /** The code was typed wrong, or the room has since closed. */
  | "no-such-room"
  /** Both chairs are taken. A room is two people; there are no spectators. */
  | "room-full"
  /** The client is from a different release than the relay. */
  | "bad-version"
  /** Not six digits. */
  | "bad-code";

/** Client → relay. */
export type ClientFrame =
  | { t: "create"; v: number }
  | { t: "join"; v: number; code: string }
  | { t: "post"; body: RoomMessage };

/** Relay → client. */
export type ServerFrame =
  /** The room exists and this client is in it. Sent once, in reply to create/join. */
  | { t: "open"; code: string; seat: RoomSeat; peer: boolean }
  /** The other chair filled or emptied. */
  | { t: "peer"; present: boolean }
  /** Something the other player said. Opaque to the relay. */
  | { t: "post"; body: RoomMessage }
  | { t: "error"; reason: RelayError };

/**
 * Player → player.
 *
 * The asymmetry is deliberate and worth reading as a list, because it is the
 * security model: everything carrying a `GameState` travels host → guest and
 * has been through `redact` on the way out. Nothing travelling guest → host is
 * bigger than an action. A guest cannot state a fact about the game, only ask
 * for one.
 */
export type RoomMessage =
  /**
   * The host's card set, sent the moment the guest arrives.
   *
   * Cards authored in the workshop live in the guest's localStorage as well as
   * the host's, and there is no reason the two agree. The host runs the engine,
   * so the host's set is the set: the guest installs this over its own for the
   * duration of the match and puts its own back afterwards. Without it the
   * guest picks a deck the host has never heard of, and every card lookup on
   * the guest's screen throws.
   */
  | { t: "catalog"; overlay: Partial<CardSet> }
  /** A deck picked in the lobby. Either direction. */
  | { t: "deck"; deck: string | null }
  /** The lobby as the host holds it. Host → guest, after every change. */
  | { t: "lobby"; decks: Record<PlayerId, string | null> }
  /** The opening position, already redacted for the guest. */
  | { t: "begin"; state: GameState }
  /** Every position after it, likewise redacted. */
  | { t: "state"; state: GameState }
  /** A move, or the run of moves one gesture produced. Guest → host. */
  | { t: "act"; actions: Action[] }
  /**
   * Take back a spell that is still being aimed.
   *
   * Cancelling is an unwind of the local history, not an engine action (see
   * `cancelCast` in `GameView.tsx`), and the history that matters lives on the
   * host. So the guest cannot do it alone: it asks, and the host — which knows
   * whose cast is in the air — either unwinds or ignores it.
   */
  | { t: "rewind" }
  /** The host declined a move. Carries a reason for the screen, not a state. */
  | { t: "refused"; reason: string }
  /** Leaving on purpose, as opposed to a socket dropping. */
  | { t: "bye" };

const CODE = /^[0-9]{6}$/;

export const isCode = (s: string): boolean => CODE.test(s);

/** Six digits, spaced for reading aloud: `481 902`. */
export const spellCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;
