import { describe, expect, it } from "vitest";
import { allDecks, legalActions } from "../engine";
import type { Action, GameState, PlayerId } from "../engine";
import { HIDDEN } from "../engine/view";
import { loopbackConnector } from "./loopback";
import { GuestMatch, HostMatch, matchFor } from "./match";
import { isCode } from "./protocol";

/**
 * A whole online match, both ends, in one process.
 *
 * These run against the real `Relay` and the real `redact`, with only the
 * socket faked, so what they check is the thing that actually ships: that a
 * guest is told enough to play and nothing more, and that the host refuses
 * everything it should.
 */

/** Let the loopback's queued microtasks drain. Every send is asynchronous. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function pair(seed: string | number = "teszt") {
  const connector = loopbackConnector();
  const hostRoom = await connector.create();
  const host = new HostMatch(hostRoom, { seed });
  const guestRoom = await connector.join(hostRoom.code);
  const guest = matchFor(guestRoom) as GuestMatch;
  await settle();
  return { connector, host, guest, code: hostRoom.code };
}

async function started(seed: string | number = "teszt") {
  const table = await pair(seed);
  const decks = allDecks();
  table.host.chooseDeck(decks[0].id);
  table.guest.chooseDeck(decks[1]?.id ?? decks[0].id);
  await settle();
  table.host.start();
  await settle();
  return table;
}

describe("the lobby", () => {
  it("hands out a six-digit code and seats the two players", async () => {
    const { host, guest, code } = await pair();
    expect(isCode(code)).toBe(true);
    expect(host.value.seat).toBe("p1");
    expect(guest.value.seat).toBe("p2");
    expect(host.value.isHost).toBe(true);
    expect(host.value.peerPresent).toBe(true);
    expect(guest.value.code).toBe(code);
  });

  it("refuses a code nobody is holding", async () => {
    const connector = loopbackConnector();
    await expect(connector.join("000001")).rejects.toThrow(/Nincs ilyen szoba/);
  });

  it("refuses a third player", async () => {
    const connector = loopbackConnector();
    const room = await connector.create();
    await connector.join(room.code);
    await expect(connector.join(room.code)).rejects.toThrow(/tele van/);
  });

  it("sends the guest the host's card set", async () => {
    const connector = loopbackConnector();
    const hostRoom = await connector.create();
    const overlay = { decks: [] } as Record<string, unknown>;
    new HostMatch(hostRoom, { overlay });
    const guest = matchFor(await connector.join(hostRoom.code)) as GuestMatch;
    await settle();
    expect(guest.value.catalog).toEqual(overlay);
  });

  it("mirrors both deck choices to both screens", async () => {
    const { host, guest } = await pair();
    const decks = allDecks();
    host.chooseDeck(decks[0].id);
    guest.chooseDeck(decks[1]?.id ?? decks[0].id);
    await settle();
    expect(host.value.decks).toEqual(guest.value.decks);
    expect(host.value.decks.p1).toBe(decks[0].id);
  });

  it("will not start until both players have picked", async () => {
    const { host, guest } = await pair();
    expect(host.canStart).toBe(false);
    host.chooseDeck(allDecks()[0].id);
    await settle();
    expect(host.canStart).toBe(false);
    host.start();
    await settle();
    expect(guest.value.state).toBeNull();

    guest.chooseDeck(allDecks()[0].id);
    await settle();
    expect(host.canStart).toBe(true);
    host.start();
    await settle();
    expect(guest.value.state).not.toBeNull();
  });

  it("refuses a deck the host has never heard of", async () => {
    const { host, guest } = await pair();
    guest.chooseDeck("nincs-ilyen-pakli");
    await settle();
    expect(host.value.decks.p2).toBeNull();
    expect(guest.value.notice).toMatch(/pakli/);
  });
});

describe("what crosses the wire", () => {
  it("never shows the guest a card in the host's hand", async () => {
    const { guest } = await started();
    const seen = guest.value.state!;
    expect(seen.players.p1.unitHand.length).toBeGreaterThan(0);
    for (const card of [...seen.players.p1.unitHand, ...seen.players.p1.spellHand]) {
      expect(card.cardId).toBe(HIDDEN);
    }
    // And the guest's own hand is intact, or there is no game to play.
    for (const card of guest.value.state!.players.p2.unitHand) {
      expect(card.cardId).not.toBe(HIDDEN);
    }
  });

  it("never sends the seed, which is every shuffle still to come", async () => {
    const { host, guest } = await started();
    expect(guest.value.state!.rng).toBe(0);
    expect(host.value.state!.rng).toBe(0);
  });

  it("gives the host a redacted position too, so nothing renders the truth", async () => {
    const { host } = await started();
    for (const card of host.value.state!.players.p2.unitHand) {
      expect(card.cardId).toBe(HIDDEN);
    }
  });

  /**
   * The rule the game screen has to obey, pinned here because it is not
   * obvious and the punishment for forgetting it is a white screen.
   *
   * A redacted position can be asked for its own seat's legal moves — the
   * whole match above is played that way — but asking it for the *other*
   * seat's moves walks into a hand of blanks, and every card lookup in the
   * engine throws on a blank. Hotseat never notices, because hotseat holds the
   * truth. `GameView` therefore only enumerates for the seat it is sitting in.
   */
  it("cannot be asked what the other player may do, which is why the screen never asks", async () => {
    const { guest } = await started();
    const state = guest.value.state!;
    expect(() => legalActions(state, "p2")).not.toThrow();
    expect(() => legalActions(state, "p1")).toThrow(/Unknown unit card/);
  });
});

describe("the host as referee", () => {
  it("refuses a move made out of turn", async () => {
    const { host, guest } = await started();
    const before = JSON.stringify(host.value.state);
    const turn = host.value.state!.turn;
    const idle: PlayerId = turn === "p1" ? "p2" : "p1";
    // Legal in shape, and legal for this player on their own turn. It is only
    // this turn that makes it not theirs to make.
    const side = idle === "p2" ? guest : host;
    side.act({ type: "declareUnitsDone", player: idle });
    await settle();
    expect(JSON.stringify(host.value.state)).toBe(before);
    expect(side.value.notice).toMatch(/nem érvényes/);
  });

  it("refuses an action that names a card the sender does not hold", async () => {
    const { host, guest } = await started();
    const before = JSON.stringify(host.value.state);
    const theirs = host.value.state!.players.p1.unitHand[0];
    guest.act({ type: "toss", player: "p1", uid: theirs.uid } as Action);
    await settle();
    expect(JSON.stringify(host.value.state)).toBe(before);
  });

  it("accepts an action shaped the way the screen builds one", async () => {
    const { host, guest } = await started();
    const mover = host.value.state!.turn;
    const side = mover === "p1" ? host : guest;
    const play = legalActions(host.value.state!, mover).find(
      (a): a is Extract<Action, { type: "playUnit" }> => a.type === "playUnit",
    );
    expect(play).toBeDefined();
    // `GameView` builds these two fields even when there is nothing in them.
    side.act({ ...play!, faceDown: false, discardUids: undefined });
    await settle();
    expect(host.value.state!.board[play!.slot]).not.toBeNull();
  });
});

describe("a whole game, played across the room", () => {
  /**
   * Both players choose from `legalActions` computed on their **own redacted
   * view**, which is the question hotseat never has to answer: a state with the
   * opponent's face-down units concealed still has to be one the screen can ask
   * for legal moves. If concealment broke that, the guest could not play at
   * all, and this is where it would show.
   */
  it("runs to a winner with neither side ever seeing the other's cards", async () => {
    const { host, guest } = await started("vegigjatszas");

    const view = (side: HostMatch | GuestMatch): GameState => side.value.state!;
    let guard = 0;
    while (view(host).phase !== "gameOver" && guard++ < 4000) {
      const state = view(host);
      const asking = state.prompts[0]?.player;
      const pending = state.resolution?.pending?.player;
      const mover: PlayerId = asking ?? pending ?? state.turn;
      const side = mover === "p1" ? host : guest;

      // The mover's own view, not the host's: this is the whole point.
      const moves = legalActions(view(side), mover);
      if (moves.length === 0) {
        // Nobody can act — either the phase belongs to the other seat or the
        // position is stuck, and a stuck position is a failure worth reporting.
        const other = mover === "p1" ? guest : host;
        const theirs = legalActions(view(other), mover === "p1" ? "p2" : "p1");
        expect(theirs.length).toBeGreaterThan(0);
        (mover === "p1" ? guest : host).act(theirs[0]);
        await settle();
        continue;
      }
      side.act(moves[guard % moves.length]);
      await settle();
    }

    expect(view(host).phase).toBe("gameOver");
    expect(view(guest).phase).toBe("gameOver");
    // Both ends agree about everything public.
    expect(view(guest).scores).toEqual(view(host).scores);
    expect(view(guest).winner).toBe(view(host).winner);
    expect(view(guest).locationIndex).toBe(view(host).locationIndex);
  });
});

describe("taking a cast back", () => {
  it("lets a player rewind their own spell and nobody else's", async () => {
    const { host, guest } = await started("visszavonas");

    // Play on until somebody has a spell in the air.
    let guard = 0;
    while (!host.value.state!.resolution?.pending && guard++ < 2000) {
      const state = host.value.state!;
      const mover: PlayerId = state.prompts[0]?.player ?? state.turn;
      const side = mover === "p1" ? host : guest;
      const moves = legalActions(side.value.state!, mover);
      if (moves.length === 0) break;
      const cast = moves.find((m) => m.type === "castSpell") ?? moves[0];
      side.act(cast);
      await settle();
    }

    const pending = host.value.state!.resolution?.pending;
    if (!pending) return; // No spell came up in this line; nothing to assert.

    const caster = pending.player;
    const wrongSide = caster === "p1" ? guest : host;
    const before = JSON.stringify(host.value.state);
    wrongSide.rewind();
    await settle();
    expect(JSON.stringify(host.value.state)).toBe(before);

    const casterSide = caster === "p1" ? host : guest;
    casterSide.rewind();
    await settle();
    expect(host.value.state!.resolution).toBeNull();
  });
});

describe("leaving", () => {
  it("tells the other player, and frees the room", async () => {
    const { connector, host, guest } = await pair();
    expect(connector.relay.roomCount).toBe(1);
    guest.close();
    await settle();
    expect(host.value.peerPresent).toBe(false);
    host.close();
    await settle();
    expect(connector.relay.roomCount).toBe(0);
  });
});
