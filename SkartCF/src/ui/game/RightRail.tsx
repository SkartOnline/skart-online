import { boardTotal, getLocation, remainingCap, slotsOf, visibleCapSpent, visibleTotal } from "../../engine";
import type { GameState, HandCard, PlayerId } from "../../engine";
import { seatName, tryCard } from "./common";

/**
 * The right rail: each player's counters and piles, with the ledger between
 * them showing whichever pile is being read.
 */

/** What the ledger is currently showing. */
export type Tracking =
  | { kind: "deck"; side: PlayerId; pile: "unit" | "spell" }
  | { kind: "grave"; side: PlayerId }
  | { kind: "score"; side: PlayerId };

/**
 * One player's standing: what the board is worth, how much of the cost cap has
 * gone, how deep each pile is, and how many battlefields they hold.
 *
 * Your own panel tells you the truth. The other panel only ever shows what you
 * are entitled to read (1.5.3): a face-down unit's cost is hidden, so it stays
 * out of their spent-cap number, and the panel says so with a "+?" rather than
 * pretending the number is complete. That mark is read off the board rather than
 * off a counter, which is what puts it on whichever side actually has something
 * face down and what makes it disappear by itself once Mustra turns everything
 * over.
 */
export function Counters({
  state,
  side,
  viewer,
  botSide,
  bare,
  onTrack,
}: {
  state: GameState;
  side: PlayerId;
  viewer: PlayerId;
  /** The seat the machine plays, so the heading can say Gép rather than a number. */
  botSide: PlayerId | null;
  bare: boolean;
  onTrack: (what: Tracking | null) => void;
}) {
  const mine = side === viewer || bare;
  const facedown = slotsOf(side).some((slot) => state.board[slot]?.faceDown);
  // While units are still going down, the other side only shows what is actually
  // visible. After Mustra both halves are public (7.9), so this only bites during
  // gathering.
  const veiled = state.phase === "units" && !mine;
  const sum = veiled ? visibleTotal(state, side) : boardTotal(state, side);
  const p = state.players[side];
  const left = remainingCap(state, side);
  const cap = left === Infinity ? null : p.capSpent + left;
  const spent = mine ? p.capSpent : visibleCapSpent(state, side);

  return (
    <div className={`counters ${side}`}>
      <span className="who">
        {seatName(side, viewer, botSide)}
        <b
          className="held-fields num"
          onMouseEnter={() => onTrack({ kind: "score", side })}
        >
          {state.scores[side]}
        </b>
      </span>
      <span className="total num">
        {sum}
        {veiled && <em>látható</em>}
      </span>
      <span className="cap-meter num">
        keret <b>{spent}</b>
        {cap === null ? "" : `/${cap}`}
        {!mine && facedown && <em title="Rejtett egység költsége nem látszik">+?</em>}
      </span>

      <span className="piles">
        <Pile
          kind="unit"
          count={p.unitDeck.length}
          track={mine ? { kind: "deck", side, pile: "unit" } : null}
          onTrack={onTrack}
        />
        <Pile
          kind="spell"
          count={p.spellDeck.length}
          track={mine ? { kind: "deck", side, pile: "spell" } : null}
          onTrack={onTrack}
        />
        <Pile
          kind="grave"
          count={p.discard.length}
          track={{ kind: "grave", side }}
          onTrack={onTrack}
        />
      </span>

      <span className="flags">
        <span className={p.flags.unitsClosed ? "shut" : "open"}>egység</span>
        <span className={p.flags.spellsClosed ? "shut" : "open"}>varázs</span>
      </span>
    </div>
  );
}

/**
 * A deck or the graveyard: a stack silhouette with its depth on it.
 *
 * Pointing at one fills the ledger down the middle of the rail rather than
 * opening a popover on the spot. A popover here was clipped by the screen edge
 * every time, and there is no reason for six of them when one panel can hold
 * whichever pile is being read.
 */
function Pile({
  kind,
  count,
  track,
  onTrack,
}: {
  kind: "unit" | "spell" | "grave";
  count: number;
  /** What the ledger should show, or `null` if this pile is not readable. */
  track: Tracking | null;
  onTrack: (what: Tracking | null) => void;
}) {
  return (
    <span
      className={`pile-icon ${kind}${track ? " readable" : ""}`}
      data-pile={kind}
      onMouseEnter={() => track && onTrack(track)}
    >
      <b className="num">{count}</b>
    </span>
  );
}

/** One line of the ledger: a card, and how many of it are in there. */
interface Tally {
  cardId: string;
  name: string;
  cost: number;
  kind: "unit" | "spell";
  count: number;
}

/**
 * Counts copies rather than listing them. A graveyard holding four rats is one
 * line reading "Patkány ×4", not four lines of Patkány, and the order is the one
 * you think in: units by cost, then spells by cost.
 *
 * A deck listing deliberately says nothing about order. What is *left* in a deck
 * is arithmetic either player could do from the public record; the sequence is
 * the part 1.5.5 protects, and sorting every listing is what guarantees this can
 * never leak it.
 */
function tally(cards: HandCard[]): Tally[] {
  const by = new Map<string, Tally>();
  for (const card of cards) {
    const found = by.get(card.cardId);
    if (found) {
      found.count += 1;
      continue;
    }
    const unit = tryCard(card.cardId, "unit");
    const known = unit ?? tryCard(card.cardId, "spell");
    if (!known) continue;
    by.set(card.cardId, {
      cardId: card.cardId,
      name: known.name,
      cost: known.cost,
      kind: unit ? "unit" : "spell",
      count: 1,
    });
  }
  return [...by.values()].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "unit" ? -1 : 1) ||
      a.cost - b.cost ||
      a.name.localeCompare(b.name, "hu"),
  );
}

/**
 * The ledger: one panel down the middle of the right rail, between the two
 * players' piles, holding whichever one is being pointed at.
 *
 * It is the deck-tracker shape on purpose. A column of counted lines is how
 * anyone who plays these games already reads a pile, and it is the one place on
 * screen with room for a list that nothing has to clip.
 */
export function Ledger({ state, tracking }: { state: GameState; tracking: Tracking | null }) {
  if (!tracking) {
    return (
      <div className="ledger empty">
        <span className="ledger-hint">Mutass rá egy paklira, a temetőre vagy az állásra.</span>
      </div>
    );
  }

  if (tracking.kind === "score") {
    const played = state.locations.filter((l) => l.winner !== null);
    return (
      <div className="ledger">
        <b className="ledger-head">Eddigi csaták</b>
        <ul className="ledger-list">
          {played.length === 0 && <li className="faint">Még nincs lejátszott csata.</li>}
          {played.map((l, i) => (
            <li key={i} className={l.winner === tracking.side ? "won" : ""}>
              <span className="ledger-name">{getLocation(l.cardId).name}</span>
              <span className="ledger-count num">
                {l.totals ? `${l.totals.p1}:${l.totals.p2}` : ""}
                {l.winner === "void" ? " –" : l.winner === tracking.side ? " ✓" : " ✕"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const p = state.players[tracking.side];
  const cards =
    tracking.kind === "grave" ? p.discard : tracking.pile === "unit" ? p.unitDeck : p.spellDeck;
  const lines = tally(cards);
  const label =
    tracking.kind === "grave"
      ? "Temető"
      : tracking.pile === "unit"
        ? "Egységpakli"
        : "Varázslatpakli";

  return (
    <div className="ledger">
      <b className="ledger-head">
        {label}
        <span className="num">{cards.length}</span>
      </b>
      <ul className="ledger-list">
        {lines.length === 0 && <li className="faint">Üres.</li>}
        {lines.map((line) => (
          <li key={line.cardId} className={line.kind}>
            <span className="ledger-cost num">{line.cost}</span>
            <span className="ledger-name">{line.name}</span>
            {line.count > 1 && <span className="ledger-count num">×{line.count}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
