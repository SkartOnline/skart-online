import {
  COLS,
  boardTotal,
  currentLocation,
  leadOf,
  power,
  remainingCap,
  slotsOf,
  visibleCapSpent,
  visibleTotal,
} from "../../engine";
import type { Action, GameState, PlayerId, Reserve } from "../../engine";
import { artFor } from "../card/model";
import { cardFor, other, seatName, tryLocation } from "./common";
import type { FieldProps } from "./common";
import type { Faction } from "./factions";
import { TurnCue } from "./LeftRail";
import type { Tracking } from "./RightRail";

/**
 * The game screen's furniture on anything wider than a phone.
 *
 * The board is the whole window. Nothing here is a box around it: four things
 * float over its margins, each where the question it answers is asked.
 *
 *   - `Campaign`, top centre: the six battlefields and the one being fought.
 *   - `Scale`, left edge: both sums, and a beam between them that moves with
 *     the fight. Each side's means and its camp hang off its own end.
 *   - `PhaseRail`, right edge: where in the battle we are, and the one thing
 *     the player may announce.
 *   - `Commander`, right edge, top and bottom: who each side fights under.
 *
 * Nothing in here explains a rule. A label names a thing; it never says what
 * the thing does, because the second battle teaches that and the sentence
 * would still be on screen in the fiftieth.
 *
 * A phone keeps the two rails and their drawers (`LeftRail`, `RightRail`,
 * `PhoneDock`); the stylesheet shows one set or the other.
 */

/** A card held up in the reading spot beside the board. */
export interface Peek {
  cardId: string;
  kind: "unit" | "spell" | "location";
  /** One line under the card: what this copy of it is doing. */
  note?: string;
}

type OnPeek = (peek: Peek | null) => void;

// ---------------------------------------------------------------------------
// The campaign
// ---------------------------------------------------------------------------

/**
 * Six battlefields as a row of lozenges, and the name and rule of the one in
 * play. A field that has been taken leans toward whoever took it and wears
 * their colour; a helyőrség stands on the field it holds, which is where 12.12
 * puts it.
 */
export function Campaign({
  state,
  viewer,
  onPeek,
}: {
  state: GameState;
  viewer: PlayerId;
  onPeek: OnPeek;
}) {
  const here = currentLocation(state);
  // A battlefield can be brought twice (3.2), so a garrison is handed to the
  // first field of that name its owner holds and to no other.
  const garrisons = state.reserves.filter((r) => r.kind === "garrison");
  const placed = new Set<string>();
  return (
    <header className="hud-campaign">
      <ol className="hud-fields">
        {state.locations.map((spot, i) => {
          const whose =
            spot.winner === null
              ? ""
              : spot.winner === "void"
                ? " void"
                : spot.winner === viewer
                  ? " mine"
                  : " theirs";
          const standing = garrisons.filter(
            (r) =>
              !placed.has(r.uid) && r.heldField === spot.cardId && r.owner === spot.winner,
          );
          standing.forEach((r) => placed.add(r.uid));
          const name = tryLocation(spot.cardId)?.name ?? "";
          return (
            <li
              key={i}
              className={`hud-field${whose}${i === state.locationIndex ? " here" : ""}`}
              onMouseEnter={() => onPeek({ cardId: spot.cardId, kind: "location" })}
              onMouseLeave={() => onPeek(null)}
              aria-label={name}
            >
              <span className="hud-gem" />
              {standing.map((r) => (
                <Token key={r.uid} reserve={r} viewer={viewer} onPeek={onPeek} />
              ))}
            </li>
          );
        })}
      </ol>
      <div className="hud-here">
        <h2>{here.name}</h2>
        <p>
          {here.text} <b className="num">Keret {here.cap}.</b>
        </p>
      </div>
    </header>
  );
}

/** A unit waiting off the board: a round portrait, its rings, and whose it is. */
function Token({
  reserve,
  viewer,
  onPeek,
}: {
  reserve: Reserve;
  viewer: PlayerId;
  onPeek: OnPeek;
}) {
  const art = artFor(reserve.cardId);
  const field = reserve.heldField ? tryLocation(reserve.heldField)?.name : undefined;
  const note = reserve.kind === "garrison" ? `Helyőrség${field ? ` · ${field}` : ""}` : "Veterán";
  return (
    <span
      className={`hud-token ${reserve.kind} ${reserve.owner === viewer ? "mine" : "theirs"}`}
      onMouseEnter={(e) => {
        e.stopPropagation();
        onPeek({ cardId: reserve.cardId, kind: "unit", note });
      }}
      onMouseLeave={() => onPeek(null)}
    >
      {art && <img src={art} alt="" decoding="async" />}
      {reserve.rings > 0 && <b className="num">{reserve.rings}</b>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

/**
 * What one side has on the table, with the same honesty rules the old counters
 * kept: your own panel tells the truth, and the other one only what 1.5.3 lets
 * you read while units are still going down.
 */
function standing(state: GameState, side: PlayerId, viewer: PlayerId, bare: boolean) {
  const mine = side === viewer || bare;
  const veiled = state.phase === "units" && !mine;
  const p = state.players[side];
  const left = remainingCap(state, side);
  const lanes = COLS.map((col) => {
    const lead = leadOf(state, side, col);
    if (!lead) return null;
    if (lead.faceDown && !mine) return "?";
    return power(lead, state);
  });
  return {
    mine,
    sum: veiled ? visibleTotal(state, side) : boardTotal(state, side),
    lanes,
    spent: veiled ? visibleCapSpent(state, side) : p.capSpent,
    cap: left === Infinity ? null : p.capSpent + left,
    hidden: !mine && slotsOf(side).some((slot) => state.board[slot]?.faceDown),
    p,
  };
}

/**
 * Both sums on one beam.
 *
 * The far side hangs from the top and the near side rises from the bottom, and
 * the beam between them is cut where the two sums meet — so who is ahead, and
 * by roughly how much, is a shape before it is a number.
 */
export function Scale({
  state,
  viewer,
  botSide,
  bare,
  onTrack,
  onPeek,
}: {
  state: GameState;
  viewer: PlayerId;
  botSide: PlayerId | null;
  bare: boolean;
  onTrack: (what: Tracking | null) => void;
  onPeek: OnPeek;
}) {
  const far = other(viewer);
  const theirs = standing(state, far, viewer, bare);
  const ours = standing(state, viewer, viewer, bare);
  const lead = ours.sum - theirs.sum;
  // An empty table balances; otherwise each arm is as long as its sum, with a
  // stub left so a side on nought still has a colour on the beam.
  const total = ours.sum + theirs.sum;
  const share = total === 0 ? 0.5 : Math.min(0.94, Math.max(0.06, theirs.sum / total));

  return (
    <aside className="hud-scale">
      <div className="hud-beam" aria-hidden="true">
        <i className="theirs" style={{ flexGrow: share }} />
        <span className={`hud-beam-mark${lead > 0 ? " mine" : lead < 0 ? " theirs" : ""}`}>
          {lead !== 0 && <b className="num">{lead > 0 ? `+${lead}` : `−${-lead}`}</b>}
        </span>
        <i className="mine" style={{ flexGrow: 1 - share }} />
      </div>
      <Side
        tone="theirs"
        side={far}
        name={seatName(far, viewer, botSide)}
        at={theirs}
        state={state}
        viewer={viewer}
        onTrack={onTrack}
        onPeek={onPeek}
      />
      <Side
        tone="mine"
        side={viewer}
        name={seatName(viewer, viewer, botSide)}
        at={ours}
        state={state}
        viewer={viewer}
        onTrack={onTrack}
        onPeek={onPeek}
      />
    </aside>
  );
}

function Side({
  tone,
  side,
  name,
  at,
  state,
  viewer,
  onTrack,
  onPeek,
}: {
  tone: "mine" | "theirs";
  side: PlayerId;
  name: string;
  at: ReturnType<typeof standing>;
  state: GameState;
  viewer: PlayerId;
  onTrack: (what: Tracking | null) => void;
  onPeek: OnPeek;
}) {
  const { p } = at;
  const offLevel =
    p.handLimit.units !== state.config.handSize ||
    p.handLimit.spells !== state.config.spellHandSize;
  const camp = state.reserves.filter((r) => r.owner === side);
  const done =
    state.phase === "units" ? p.flags.unitsClosed : state.phase === "battle" && p.flags.spellsClosed;

  return (
    // `data-seat` is what the draw and discard flights aim at (`GameView`,
    // `Prologue`): the piles in here are where a card leaves from and lands.
    <section className={`hud-side ${tone}`} data-seat={side}>
      <h3 className="hud-who">
        {name}
        {done && <em>kész</em>}
      </h3>
      <div className="hud-total num">
        {at.sum}
        {at.hidden && <sup title="Rejtett egység ereje nem látszik">?</sup>}
      </div>
      <div className="hud-lanes num" title="Élharcosok oszloponként">
        {at.lanes.map((lane, i) => (
          <span key={i} className={lane === null ? "none" : ""}>
            {lane ?? "–"}
          </span>
        ))}
      </div>
      <dl className="hud-means">
        <div>
          <dt>keret</dt>
          <dd className="num">
            <b>{at.spent}</b>
            {at.cap === null ? "" : ` / ${at.cap}`}
            {at.hidden && <em title="Rejtett egység költsége nem látszik"> +?</em>}
          </dd>
        </div>
        <div className={offLevel ? "moved" : ""} title="Kézkeret: egység · varázslat">
          <dt>kéz</dt>
          <dd className="num">
            <b>{p.unitHand.length}</b> / {p.handLimit.units} · <b>{p.spellHand.length}</b> /{" "}
            {p.handLimit.spells}
          </dd>
        </div>
      </dl>
      <div className="hud-piles" onMouseLeave={() => onTrack(null)}>
        <Pile
          kind="unit"
          label="Egységpakli"
          count={p.unitDeck.length}
          track={at.mine ? { kind: "deck", side, pile: "unit" } : null}
          onTrack={onTrack}
        />
        <Pile
          kind="spell"
          label="Varázslatpakli"
          count={p.spellDeck.length}
          track={at.mine ? { kind: "deck", side, pile: "spell" } : null}
          onTrack={onTrack}
        />
        <Pile
          kind="grave"
          label="Temető"
          count={p.discard.length}
          track={{ kind: "grave", side }}
          onTrack={onTrack}
        />
      </div>
      {camp.length > 0 && (
        <ul className="hud-camp">
          {camp.map((r) => (
            <li key={r.uid}>
              <Token reserve={r} viewer={viewer} onPeek={onPeek} />
              <span>
                <b>{cardFor(r.cardId)?.name ?? ""}</b>
                <em>
                  {r.kind === "garrison"
                    ? (r.heldField && tryLocation(r.heldField)?.name) || "helyőrség"
                    : "veterán"}
                </em>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A deck or the graveyard, as a small card-shaped count. Pointing at one reads it. */
function Pile({
  kind,
  label,
  count,
  track,
  onTrack,
}: {
  kind: "unit" | "spell" | "grave";
  label: string;
  count: number;
  track: Tracking | null;
  onTrack: (what: Tracking | null) => void;
}) {
  return (
    <span
      className={`pile-icon hud-pile ${kind}${track ? " readable" : ""}`}
      data-pile={kind}
      title={label}
      onMouseEnter={() => onTrack(track)}
    >
      <b className="num">{count}</b>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The phase, and the one thing to announce
// ---------------------------------------------------------------------------

const STEPS: { key: string; label: string }[] = [
  { key: "arrive", label: "Érkezés" },
  { key: "units", label: "Gyülekezés" },
  { key: "mustra", label: "Mustra" },
  { key: "battle", label: "Csata" },
  { key: "scored", label: "Összesítés" },
  { key: "cleanup", label: "Leszerelés" },
];

/**
 * The battle as six steps with the current one lit, and under them the turn
 * cue: whose move it is and the button that ends theirs.
 */
export function PhaseRail(props: FieldProps & { moves: Action[]; viewer: PlayerId }) {
  const { state } = props;
  if (state.phase === "gameOver") return null;
  // 12.12.6: veterans and garrisons arrive after the field turns over and
  // before anyone gathers. The engine keeps that inside the units phase.
  const at = state.phase === "units" && state.arrivals.length > 0 ? "arrive" : state.phase;
  return (
    <div className="hud-phase">
      <ol className="hud-steps">
        {STEPS.map((step) => (
          <li key={step.key} className={step.key === at ? "here" : ""}>
            {step.label}
          </li>
        ))}
      </ol>
      <TurnCue {...props} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The commander's place
// ---------------------------------------------------------------------------

/**
 * Who a side fights under.
 *
 * There are no commander cards yet, so the plate carries the order's mark and
 * name and nothing else. It is here now so that the screen already has the
 * place: the far side's at the top of the right edge, yours at the bottom.
 */
export function Commander({ faction, tone }: { faction: Faction; tone: "mine" | "theirs" }) {
  return (
    <div className={`hud-commander ${tone}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={faction.mark} />
      </svg>
      <span>{faction.name}</span>
    </div>
  );
}
