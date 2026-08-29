import { allDecks, applyAction, createGame, legalActions, redact } from "../engine";
import type { Action, CardSet, GameState, PlayerId } from "../engine";
import { SEAT_OF } from "./protocol";
import type { RoomMessage } from "./protocol";
import type { Room } from "./room";

/**
 * A match across a room.
 *
 * ## Who holds what
 *
 * The host's browser is the server. It holds the one real `GameState`, applies
 * every action to it — its own and the guest's — and is the only thing in the
 * world entitled to call `applyAction`. The guest holds a picture.
 *
 * That picture is `redact(truth, "p2")`, and the host renders `redact(truth,
 * "p1")` of the same position rather than the truth it is sitting on. Two
 * reasons, and the second is the better one:
 *
 * - Nothing in the host's React tree ever contains the guest's hand, so it
 *   cannot leak through a devtools panel, a state dump or a screenshot. The
 *   full position exists in exactly one object, in this file, and nothing
 *   renders it.
 * - Both screens are then rendering the same shape, so `GameView` has no idea
 *   which end of the wire it is on. Online play needed no new rendering path:
 *   it is the hotseat screen with a fixed seat and a different sink for its
 *   actions.
 *
 * The cost of host-authoritative is honest and worth stating: a host who opens
 * a debugger can read the guest's hand out of this object. The guest is fully
 * protected, the host is on their honour, and for a game two friends arrange
 * between themselves that is the right trade. Moving the truth to a server
 * would close it, at the price of the server needing the card set — including
 * whatever either of them built in the workshop that afternoon.
 *
 * ## Why the host validates its own moves too
 *
 * `applyAction` does not throw on an illegal action. It quietly does nothing,
 * or worse, something — `doToss` will happily throw away a card belonging to
 * whoever the action names. So "apply it and see" is not a check, and every
 * action arriving here is instead tested for membership of `legalActions(state,
 * sender)`, which is the same enumeration the bot and the simulator pick from.
 *
 * The host's own moves go through it as well. They come from a screen that
 * should only ever build legal ones, so this ought to be dead code — which is
 * exactly why it is there. A refusal on the host's own action is a bug in the
 * interface, and it is better to watch it stop than to watch the position
 * drift.
 */

export interface MatchState {
  code: string;
  /** Which seat this client plays. The host is always p1; see `SEAT_OF`. */
  seat: PlayerId;
  isHost: boolean;
  /** Is the other player connected? */
  peerPresent: boolean;
  decks: Record<PlayerId, string | null>;
  /**
   * The host's card set, once it has arrived. Guest only, and the guest must
   * install it before rendering anything: the host runs the engine, so the
   * host's cards are the cards.
   */
  catalog: Partial<CardSet> | null;
  /** Redacted for `seat`, on both sides. Null until the host starts. */
  state: GameState | null;
  /** Something to say out loud once, then forget. */
  notice: string | null;
  /** The match is over as a connection: the peer left, or the room closed. */
  ended: string | null;
}

export interface MatchOptions {
  /** The host's workshop cards, sent to the guest on arrival. */
  overlay?: Partial<CardSet>;
  /** Fixed by the tests; otherwise the clock. */
  seed?: string | number;
}

/**
 * Canonical form, for comparing an action the screen built against one the
 * engine offered.
 *
 * The screen builds `faceDown: false` and `discardUid: undefined` where
 * `legalActions` simply omits both, so a plain `JSON.stringify` comparison
 * would refuse every ordinary unit placement. Keys are sorted because object
 * literal order is not a promise anybody made.
 */
function canonical(action: Action): string {
  const raw = action as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort()) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (key === "faceDown" && value === false) continue;
    out[key] = value;
  }
  return JSON.stringify(out);
}

export function isLegal(state: GameState, player: PlayerId, action: Action): boolean {
  const wanted = canonical(action);
  return legalActions(state, player).some((offered) => canonical(offered) === wanted);
}

type Listener = (state: MatchState) => void;

/**
 * The half of a match both ends share: the snapshot, the subscribers, the
 * room's comings and goings. `HostMatch` and `GuestMatch` differ only in what
 * they do with an action.
 */
abstract class Match {
  protected snapshot: MatchState;
  private listeners = new Set<Listener>();
  private unsubscribes: (() => void)[] = [];

  constructor(protected room: Room) {
    this.snapshot = {
      code: room.code,
      seat: SEAT_OF[room.seat],
      isHost: room.seat === "host",
      peerPresent: room.peerPresent,
      decks: { p1: null, p2: null },
      catalog: null,
      state: null,
      notice: null,
      ended: null,
    };
    this.unsubscribes.push(
      room.onMessage((m) => this.receive(m)),
      room.onPeer((present) => this.peerChanged(present)),
      room.onClosed((reason) => this.patch({ ended: reason, peerPresent: false })),
    );
  }

  get value(): MatchState {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected patch(change: Partial<MatchState>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }

  /** Say goodbye, so the other side knows it was a choice and not a tunnel. */
  close(): void {
    try {
      this.room.send({ t: "bye" });
    } catch {
      // The socket is already gone; there is nobody left to tell.
    }
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.listeners.clear();
    this.room.close();
  }

  abstract chooseDeck(deck: string | null): void;
  /** One action, or the run of them a single gesture produced. */
  abstract act(actions: Action | Action[]): void;
  /** Take back a spell still being aimed. Never a rule; see `RoomMessage`. */
  abstract rewind(): void;

  protected abstract receive(message: RoomMessage): void;
  protected abstract peerChanged(present: boolean): void;
}

export class HostMatch extends Match {
  /** The only real position there is. Nothing renders it. */
  private truth: GameState | null = null;
  /** Truth, backwards, for taking a cast back. Trimmed like the screen's. */
  private past: GameState[] = [];
  private overlay: Partial<CardSet>;
  private seed?: string | number;

  constructor(room: Room, options: MatchOptions = {}) {
    super(room);
    this.overlay = options.overlay ?? {};
    this.seed = options.seed;
    if (room.peerPresent) this.greet();
  }

  chooseDeck(deck: string | null): void {
    this.patch({ decks: { ...this.snapshot.decks, p1: deck } });
    this.publishLobby();
  }

  /** Both decks picked, both players present, nothing dealt yet. */
  get canStart(): boolean {
    const { decks, peerPresent, state } = this.snapshot;
    return !state && peerPresent && !!decks.p1 && !!decks.p2;
  }

  start(): void {
    if (!this.canStart) return;
    const { p1, p2 } = this.snapshot.decks;
    try {
      this.truth = createGame({
        seed: this.seed ?? Date.now(),
        decks: { p1: p1!, p2: p2! },
      });
    } catch (e) {
      this.patch({ notice: String(e) });
      return;
    }
    this.past = [];
    this.room.send({ t: "begin", state: redact(this.truth, "p2") });
    this.patch({ state: redact(this.truth, "p1"), notice: null });
  }

  act(actions: Action | Action[]): void {
    this.apply(Array.isArray(actions) ? actions : [actions], "p1");
  }

  rewind(): void {
    this.unwind("p1");
  }

  protected receive(message: RoomMessage): void {
    switch (message.t) {
      case "deck": {
        // A deck the host has never heard of would throw inside `createGame`,
        // on the host, at the moment it pressed start. Catch it while there is
        // still somebody looking at a lobby.
        const known = message.deck === null || allDecks().some((d) => d.id === message.deck);
        if (!known) {
          this.room.send({ t: "refused", reason: "Ilyen pakli nincs a másik gépen." });
          return;
        }
        this.patch({ decks: { ...this.snapshot.decks, p2: message.deck } });
        this.publishLobby();
        return;
      }
      case "act":
        this.apply(message.actions, "p2");
        return;
      case "rewind":
        this.unwind("p2");
        return;
      case "bye":
        this.patch({ ended: "Az ellenfeled kilépett.", peerPresent: false });
        return;
      default:
        // Everything else is a message only a host sends. A guest saying one is
        // either a bug or somebody poking at the socket; either way, ignore it.
        return;
    }
  }

  protected peerChanged(present: boolean): void {
    this.patch({ peerPresent: present, ended: present ? null : this.snapshot.ended });
    if (present) this.greet();
  }

  /** What a guest is told the moment it arrives: the cards, then the lobby. */
  private greet(): void {
    this.room.send({ t: "catalog", overlay: this.overlay });
    this.publishLobby();
    // A guest arriving to a game already under way — a reload, a reconnect —
    // gets the position rather than a lobby.
    if (this.truth) this.room.send({ t: "begin", state: redact(this.truth, "p2") });
  }

  private publishLobby(): void {
    this.room.send({ t: "lobby", decks: this.snapshot.decks });
  }

  /**
   * The authoritative step. Every action in a run is checked against the
   * position it would actually be applied to, not the one the run started
   * from: a gesture that plays a trap answers two questions, and the second is
   * only legal because the first was.
   */
  private apply(actions: Action[], from: PlayerId): void {
    if (!this.truth || actions.length === 0) return;
    let next = this.truth;
    const history: GameState[] = [];
    for (const action of actions) {
      if (!isLegal(next, from, action)) {
        this.refuse(from, "Ez a lépés már nem érvényes.");
        return;
      }
      history.push(next);
      next = applyAction(next, action);
    }
    this.truth = next;
    this.past = [...this.past, ...history].slice(-40);
    this.broadcast();
  }

  /**
   * Cancelling a cast, from either chair.
   *
   * The same walk the hotseat screen does: back over every position that still
   * had a spell in the air, landing on the one before the cast. It is only ever
   * granted to whoever is holding the spell, so a guest cannot rewind the
   * host's turn by asking nicely.
   */
  private unwind(from: PlayerId): void {
    if (!this.truth) return;
    if (this.truth.resolution?.pending?.player !== from) return;
    let at = this.past.length;
    while (at > 0 && this.past[at - 1].resolution !== null) at -= 1;
    if (at === 0) return;
    this.truth = this.past[at - 1];
    this.past = this.past.slice(0, at - 1);
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.truth) return;
    this.room.send({ t: "state", state: redact(this.truth, "p2") });
    this.patch({ state: redact(this.truth, "p1"), notice: null });
  }

  private refuse(from: PlayerId, reason: string): void {
    if (from === "p2") this.room.send({ t: "refused", reason });
    else this.patch({ notice: reason });
  }
}

export class GuestMatch extends Match {
  chooseDeck(deck: string | null): void {
    // Recorded locally as well as sent, so the button lights up on the press
    // rather than on the round trip. The host's `lobby` overwrites it a moment
    // later, and the host's copy is the one that counts.
    this.patch({ decks: { ...this.snapshot.decks, p2: deck } });
    this.room.send({ t: "deck", deck });
  }

  act(actions: Action | Action[]): void {
    this.room.send({ t: "act", actions: Array.isArray(actions) ? actions : [actions] });
  }

  rewind(): void {
    this.room.send({ t: "rewind" });
  }

  protected receive(message: RoomMessage): void {
    switch (message.t) {
      case "catalog":
        this.patch({ catalog: message.overlay });
        return;
      case "lobby":
        this.patch({ decks: message.decks });
        return;
      case "begin":
      case "state":
        this.patch({ state: message.state, notice: null });
        return;
      case "refused":
        this.patch({ notice: message.reason });
        return;
      case "bye":
        this.patch({ ended: "Az ellenfeled kilépett.", peerPresent: false });
        return;
      default:
        return;
    }
  }

  protected peerChanged(present: boolean): void {
    this.patch({
      peerPresent: present,
      ended: present ? null : "Az ellenfeled kapcsolata megszakadt.",
    });
  }
}

export function matchFor(room: Room, options: MatchOptions = {}): HostMatch | GuestMatch {
  return room.seat === "host" ? new HostMatch(room, options) : new GuestMatch(room);
}
