import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  boardTotal,
  createGame,
  currentLocation,
  getLocation,
  getSpell,
  getUnit,
  isMasterSpell,
  ALL_SLOTS,
  legalActions,
  remainingCap,
  slotsOf,
  visibleCapSpent,
  visibleTotal,
} from "../../engine";
import type {
  Action,
  GameState,
  HandCard,
  PlayerId,
  SlotId,
  SpellCard,
  UnitCard,
} from "../../engine";
import CardFace from "../card/CardFace";
import { artFor } from "../card/model";
import Board, { Loaded } from "./Board";
import NewGame from "./NewGame";
import type { Sides } from "./NewGame";
import { makeBot } from "./bot";
import type { Agent } from "../../bot/agent";
import {
  anchorRect,
  BEAT_MS,
  beatsBetween,
  beginCardDrag,
  captureHandCard,
  flyBack,
  flyTo,
  slotElement,
} from "./theatre";
import type { Beat, BeatKind, Flight } from "./theatre";

interface Held {
  uid: string;
  veiled: boolean;
  tollUid: string | null;
}

const SIDE: Record<PlayerId, string> = { p1: "Első", p2: "Második" };

const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

export default function GameView({ onLeave }: { onLeave: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const [past, setPast] = useState<GameState[]>([]);
  const [held, setHeld] = useState<Held | null>(null);
  const [bare, setBare] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [botSide, setBotSide] = useState<PlayerId | null>(null);
  const bot = useRef<Agent | null>(null);

  // What is currently worth watching. Beats are derived from the difference
  // between two states and expire on their own, so they can only ever decorate
  // what the board already shows.
  const [beats, setBeats] = useState<LiveBeat[]>([]);
  /** Captured before the state changes, launched after it has rendered. */
  const pendingFlight = useRef<{ flight: Flight; slot?: SlotId } | null>(null);

  function begin(sides: Sides) {
    try {
      setState(createGame({ seed: sides.seed, decks: { p1: sides.p1, p2: sides.p2 } }));
      bot.current = sides.bot ? makeBot(sides.difficulty, Date.now() >>> 0) : null;
      setBotSide(bot.current ? sides.bot : null);
      setPast([]);
      setHeld(null);
      setFault(null);
      setBeats([]);
    } catch (e) {
      setFault(String(e));
    }
  }

  function send(action: Action) {
    if (!state) return;
    try {
      // The card has to be cloned while it still exists in the hand, which is
      // now: applying the action is what takes it away.
      if (action.type === "playUnit" || action.type === "castSpell") {
        const flight = captureHandCard(action.uid);
        if (flight) {
          pendingFlight.current = {
            flight,
            slot: action.type === "playUnit" ? action.slot : undefined,
          };
        }
      }
      const next = applyAction(state, action);
      const now = Date.now();
      setPast((h) => [...h.slice(-40), state]);
      setBeats((b) => [
        ...b,
        ...beatsBetween(state, next).map((beat) => ({
          ...beat,
          expiresAt: now + BEAT_MS[beat.kind],
        })),
      ]);
      setState(next);
      setHeld(null);
      setFault(null);
    } catch (e) {
      setFault(String(e));
    }
  }

  // Launch the flight now that the destination is on screen. The effect body
  // runs after the commit, so the tile the card is flying to already exists and
  // already has its final geometry. Deliberately no cleanup and no rAF: React's
  // development double-invoke would cancel the frame between the two runs and
  // the card would never leave the hand.
  useEffect(() => {
    const queued = pendingFlight.current;
    if (!queued) return;
    pendingFlight.current = null;
    // A unit flies to the tile it was committed to. A spell has no tile yet —
    // its caster and target are still being nominated — so it flies to the panel
    // that is about to hold it up for both players to read.
    const target = queued.slot
      ? slotElement(queued.slot)
      : document.querySelector(".playbill .cardface, .playbill");
    flyTo(queued.flight, target);
  }, [state]);

  // Cards leaving a deck for a hand, or a hand for the discard pile. Fired once
  // per beat: the beat list is rebuilt on every render, so without a record of
  // what has already flown, a single draw would re-launch itself continuously.
  const flown = useRef(new Set<number>());
  useEffect(() => {
    if (!state) return;
    for (const beat of beats) {
      if (beat.kind !== "draw" && beat.kind !== "toss") continue;
      if (flown.current.has(beat.id)) continue;
      flown.current.add(beat.id);
      const side = beat.player;
      if (!side) continue;
      const near = side === (botSide ? other(botSide) : state.turn);
      const hand = anchorRect(near ? ".hand-rail.near" : ".hand-rail.far");
      const deck = anchorRect(`.counters.${side} .pile-icon.unit`);
      const grave = anchorRect(`.counters.${side} .pile-icon.grave`);
      const count = Math.min(beat.count ?? 1, 6);
      for (let i = 0; i < count; i++) {
        if (beat.kind === "draw") flyBack("unit", deck, hand, i);
        else flyBack("unit", hand, grave, i, 420);
      }
    }
  }, [beats, botSide, state]);

  // One timer, aimed at whichever beat expires first. Each beat carries its own
  // deadline, so a new batch arriving never extends the life of an old one.
  useEffect(() => {
    if (beats.length === 0) return;
    const soonest = Math.min(...beats.map((b) => b.expiresAt));
    const timer = setTimeout(
      () => setBeats((current) => current.filter((b) => b.expiresAt > Date.now())),
      Math.max(16, soonest - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [beats]);

  function stepBack() {
    setPast((h) => {
      if (h.length === 0) return h;
      setState(h[h.length - 1]);
      setHeld(null);
      setBeats([]);
      return h.slice(0, -1);
    });
  }

  if (!state) return <NewGame onStart={begin} onLeave={onLeave} />;

  const pending = state.resolution?.pending ?? null;
  const actor: PlayerId | null = pending
    ? pending.player
    : state.phase === "units" ||
        state.phase === "battle" ||
        state.phase === "scored" ||
        state.phase === "cleanup"
      ? state.turn
      : null;

  return (
    <Field
      state={state}
      actor={actor}
      botSide={botSide}
      bot={bot}
      beats={beats}
      held={held}
      setHeld={setHeld}
      send={send}
      stepBack={stepBack}
      canStepBack={past.length > 0}
      bare={bare}
      setBare={setBare}
      onQuit={() => setState(null)}
      onLeave={onLeave}
      fault={fault}
    />
  );
}

/** A beat plus the moment it stops being shown. */
type LiveBeat = Beat & { expiresAt: number };

interface FieldProps {
  state: GameState;
  actor: PlayerId | null;
  /** The seat the machine is playing, or `null` for hotseat. */
  botSide: PlayerId | null;
  bot: React.MutableRefObject<Agent | null>;
  /** What just happened, for the theatre to show. Never read for rules. */
  beats: LiveBeat[];
  held: Held | null;
  setHeld: (h: Held | null) => void;
  send: (a: Action) => void;
  stepBack: () => void;
  canStepBack: boolean;
  bare: boolean;
  setBare: (v: boolean) => void;
  onQuit: () => void;
  onLeave: () => void;
  fault: string | null;
}

/**
 * The board owns the screen. Everything else is pushed into the two side rails,
 * because vertical space is what the board actually needs: a bar across the top
 * costs a row of tiles, a column down the side costs nothing the board wanted.
 */
function Field(props: FieldProps) {
  const { state, actor, held, setHeld, send, bare, botSide, bot, beats } = props;
  const pending = state.resolution?.pending ?? null;
  const [logOpen, setLogOpen] = useState(false);
  /** The tile being read. Never a rule, only what the loupe beside the board shows. */
  const [inspect, setInspect] = useState<SlotId | null>(null);
  const inspected = inspect ? state.board[inspect] : null;
  /** The card in hand being read, and the one currently in the air. */
  const [reading, setReading] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  /** Which pile the ledger is holding open. */
  const [tracking, setTracking] = useState<Tracking | null>(null);

  // The table turns so whoever is acting sits at the bottom of the screen, with
  // their hand in front of them and the enemy across the line. Against the
  // machine it does not turn: the camera stays with the person holding the
  // keyboard, and the machine plays from the far side like an opponent would.
  const human: PlayerId | null = botSide ? other(botSide) : null;
  const viewer: PlayerId = human ?? actor ?? state.turn;
  const far = other(viewer);

  // The machine moves on a timer rather than instantly, so its turn is something
  // you watch happen instead of a board that has already changed. The wait is
  // long enough for the previous beat to finish playing: a card flying out of the
  // machine's hand is the only signal that it did anything at all.
  const botToMove = botSide !== null && actor === botSide && state.phase !== "gameOver";
  useEffect(() => {
    if (!botToMove || !bot.current) return;
    const busy = beats.some((b) => b.kind === "land" || b.kind === "veil" || b.kind === "cast");
    const timer = setTimeout(
      () => {
        const action = bot.current?.choose(state, botSide!);
        if (action) send(action);
      },
      busy ? 950 : 620,
    );
    return () => clearTimeout(timer);
  }, [botToMove, state, botSide, bot, send, beats]);

  const moves = useMemo(() => (actor ? legalActions(state, actor) : []), [state, actor]);

  const open = useMemo(() => {
    const set = new Set<SlotId>();
    if (pending && pending.kind !== "handCard") {
      for (const slot of pending.options) set.add(slot);
      return set;
    }
    if (state.phase === "units" && held) {
      for (const m of moves) {
        if (m.type !== "playUnit" || m.uid !== held.uid) continue;
        if ((m.faceDown === true) !== held.veiled) continue;
        if (held.veiled && m.discardUid !== held.tollUid) continue;
        set.add(m.slot);
      }
    }
    return set;
  }, [state.phase, pending, held, moves]);

  function commit(slot: SlotId, card: Held) {
    if (!actor) return;
    send({
      type: "playUnit",
      player: actor,
      uid: card.uid,
      slot,
      faceDown: card.veiled,
      discardUid: card.tollUid ?? undefined,
    });
  }

  function pickSlot(slot: SlotId) {
    if (pending) {
      send({ type: "chooseSlot", player: pending.player, slot });
      return;
    }
    if (state.phase === "units" && held && actor) commit(slot, held);
  }

  /**
   * Picking a card up out of the hand. Selecting it is the same thing a click
   * does, so the legal tiles light up while it is in the air and the drop goes
   * through exactly the action a click would have produced. Dropping anywhere
   * else puts the card back and leaves it selected, which is what a hand of paper
   * would do.
   */
  function startDrag(event: React.PointerEvent, card: Held) {
    if (event.button !== 0 || state.phase !== "units") return;
    setHeld(card);
    const session = beginCardDrag(card.uid, event.nativeEvent, {
      onDrop: (slot) => commit(slot, card),
      onEnd: () => setLifted(null),
    });
    // No session means the card had no node to clone; the click path still works.
    if (!session) return;
    event.preventDefault();
    // Out of the hand and into your fingers: the fan shows the gap it left until
    // the card is dropped, and the full-size copy gets out of the way.
    setLifted(card.uid);
    setReading(null);
  }

  const over = state.phase === "gameOver";
  const inHand = [...state.players[viewer].unitHand, ...state.players[viewer].spellHand];
  const liftedStillHeld = lifted && inHand.some((c) => c.uid === lifted) ? lifted : null;
  const readCard = reading ? inHand.find((c) => c.uid === reading) : undefined;

  // Which tiles are mid-animation, and what to hold in the panel. Both are read
  // off the beats, never off the board, so they fade on their own.
  const stirring = useMemo(() => {
    const out = new Map<SlotId, BeatKind>();
    for (const beat of beats) {
      if (!beat.slot) continue;
      if (
        beat.kind === "land" ||
        beat.kind === "veil" ||
        beat.kind === "reveal" ||
        beat.kind === "strike"
      ) {
        out.set(beat.slot, beat.kind);
      }
    }
    return out;
  }, [beats]);

  const fallen = useMemo(
    () => beats.filter((b) => b.kind === "fall" && b.slot && !state.board[b.slot]),
    [beats, state.board],
  );

  return (
    <div className={`field${over ? "" : " opening"}`}>
      <span className="flight-layer" />
      <Theatre beats={beats} viewer={viewer} bare={bare} />
      <aside className="rail-left">
        <Battlefield {...props} onLog={() => setLogOpen((v) => !v)} logOpen={logOpen} />
        <TurnCue {...props} moves={moves} viewer={viewer} />
        <Annals state={state} viewer={viewer} />
        <Tools {...props} onLog={() => setLogOpen((v) => !v)} logOpen={logOpen} />
      </aside>

      <div className="arena">
        <Board
          state={state}
          open={open}
          onPick={pickSlot}
          bare={bare}
          viewer={viewer}
          stirring={stirring}
          fallen={fallen}
          onInspect={setInspect}
        />
      </div>

      {/* The tile you are reading, printed beside the board. A sibling of the
          board rather than a child of the tile, so nothing on the board can clip
          it and it never covers the units it is being compared against. */}
      {inspected && (
        <div className={`loupe ${inspected.owner === viewer ? "mine" : "theirs"}`}>
          <Loaded unit={inspected} state={state} />
        </div>
      )}

      {/* The far player's piles, the ledger, then yours. The ledger sits between
          them because that is where both sets of piles can reach it. */}
      <aside className="rail-right">
        <Counters state={state} side={far} viewer={viewer} bare={bare} onTrack={setTracking} />
        <Ledger state={state} tracking={tracking} />
        <Counters state={state} side={viewer} viewer={viewer} bare={bare} onTrack={setTracking} />
      </aside>

      {!over && <FarHand state={state} player={far} bare={bare} />}
      {!over && (
        <NearHand
          {...props}
          moves={moves}
          viewer={viewer}
          onDrag={startDrag}
          onRead={setReading}
          lifted={liftedStillHeld}
        />
      )}

      {/* The card under the pointer, printed at full size above its own place in
          the fan. Nothing in the hand moves to make this happen. */}
      {readCard && !liftedStillHeld && <Reading uid={readCard.uid} cardId={readCard.cardId} />}

      {logOpen && <Chronicle state={state} onClose={() => setLogOpen(false)} />}
      {over && <Aftermath state={state} onLeave={props.onLeave} onQuit={props.onQuit} />}
    </div>
  );
}

// ------------------------------------------------------------------ theatre

/**
 * What just happened, shown rather than described.
 *
 * Two pieces. A banner across the middle for the things that reframe the board —
 * a battlefield turning over, a step of 5.1 beginning — and a panel down the side
 * holding the last card that was played, printed at full size, the way you would
 * expect to be shown a card somebody just put on the table.
 *
 * The panel never shows a face-down unit. A hidden unit's identity is hidden
 * (1.5.2), and the beat it comes from carries no card id at all, so there is
 * nothing here that could leak it even by accident.
 */
function Theatre({
  beats,
  viewer,
  bare,
}: {
  beats: LiveBeat[];
  viewer: PlayerId;
  bare: boolean;
}) {
  const frame = [...beats].reverse().find((b) => b.kind === "battlefield" || b.kind === "step");
  const shown = [...beats]
    .reverse()
    .find((b) => b.kind === "land" || b.kind === "cast" || b.kind === "veil");

  return (
    <>
      {frame && (
        <div key={frame.id} className={`herald ${frame.kind}`}>
          {frame.kind === "battlefield" ? (
            <>
              <b>{tryLocationName(frame.cardId)}</b>
              <em>{capLabel(frame.cardId)}</em>
            </>
          ) : (
            <>
              <b>{frame.text}</b>
              {frame.detail && <em>{frame.detail}</em>}
            </>
          )}
        </div>
      )}

      {shown && (
        <div
          key={shown.id}
          className={`playbill ${shown.player === viewer ? "mine" : "theirs"} ${shown.kind}`}
        >
          {shown.cardId ? (
            <CardFace
              card={cardFor(shown.cardId)!}
              className={shown.kind === "cast" ? "spell" : ""}
            />
          ) : (
            // A hidden unit. The panel says a card went down and no more, unless
            // the hotseat reveal switch is on.
            <span className="cardback unit" />
          )}
          <span className="playbill-note">
            {shown.kind === "cast"
              ? "varázslat"
              : shown.cardId || bare
                ? "egység"
                : "rejtett egység"}
          </span>
        </div>
      )}
    </>
  );
}

function tryLocationName(id: string | undefined): string {
  if (!id) return "";
  try {
    return getLocation(id).name;
  } catch {
    return id;
  }
}

function capLabel(id: string | undefined): string {
  if (!id) return "";
  try {
    const cap = getLocation(id).cap;
    return cap === null ? "keret ∞" : `keret ${cap}`;
  } catch {
    return "";
  }
}

function cardFor(id: string): UnitCard | SpellCard | undefined {
  try {
    return getUnit(id);
  } catch {
    try {
      return getSpell(id);
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------- left rail

/**
 * The battlefield being fought over, printed rather than described, plus the
 * few controls that are not part of playing.
 */
function Battlefield({ state, onLeave }: FieldProps & { onLog: () => void; logOpen: boolean }) {
  const location = currentLocation(state);
  const here = state.locations[state.locationIndex];
  return (
    <>
      <div className="rail-top">
        <button className="quiet tiny" onClick={onLeave}>
          Menü
        </button>
        <span className="score num">
          <span className="p1">{state.scores.p1}</span>
          <span className="faint">:</span>
          <span className="p2">{state.scores.p2}</span>
        </span>
      </div>

      <CardFace card={location} className="battlefield" />

      <div className="rail-note">
        <span className="num">
          {state.locationIndex + 1}/{state.locations.length}
        </span>
        <span className="num cap">keret {location.cap === null ? "∞" : location.cap}</span>
        <span className="faint">{SIDE[here.broughtBy]} hozta</span>
      </div>
    </>
  );
}

/**
 * The battle so far, down the left rail: one entry per thing that happened, with
 * a picture of the card that did it.
 *
 * This is the skeleton. There is no card art in the set yet, so every entry draws
 * an empty frame in the right shape and the right colour — a unit frame, a spell
 * frame, a battlefield frame — and the art slot fills itself in the moment
 * `artFor` starts returning anything. The point of building it now is the shape:
 * a column of pictures reads as a story at a glance, which the text chronicle
 * behind the Krónika button never will, however good the wording is.
 */
function Annals({ state, viewer }: { state: GameState; viewer: PlayerId }) {
  const here = state.locationIndex;
  const entries: { key: string; owner: PlayerId | null; cardId: string; kind: "unit" | "spell" }[] =
    [];

  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    // A face-down unit is not named anywhere, including here.
    if (!unit || unit.faceDown) continue;
    entries.push({ key: `u${unit.uid}`, owner: unit.owner, cardId: unit.cardId, kind: "unit" });
  }
  for (const cast of state.spellsCast) {
    entries.push({ key: `s${cast.uid}`, owner: cast.owner, cardId: cast.cardId, kind: "spell" });
  }

  return (
    <div className="annals" key={here}>
      <b className="annals-head">Krónika</b>
      <ul className="annals-list">
        {entries.length === 0 && <li className="faint annals-empty">Még üres a csatatér.</li>}
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`annal ${entry.kind} ${entry.owner === viewer ? "mine" : "theirs"}`}
          >
            <span className="annal-art">
              {artFor(entry.cardId) && <img src={artFor(entry.cardId)} alt="" />}
            </span>
            <span className="annal-name">{cardNameOf(entry.cardId)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function cardNameOf(id: string): string {
  return cardFor(id)?.name ?? "";
}

function Tools({
  bare,
  setBare,
  stepBack,
  canStepBack,
  onQuit,
  onLog,
  logOpen,
}: FieldProps & { onLog: () => void; logOpen: boolean }) {
  return (
    <div className="rail-tools">
      <button className={`tiny${logOpen ? " ember" : ""}`} onClick={onLog}>
        Krónika
      </button>
      <button className="quiet tiny" onClick={stepBack} disabled={!canStepBack}>
        Vissza
      </button>
      <label className="swap">
        <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
        Mindent mutat
      </label>
      <button className="quiet tiny" onClick={onQuit}>
        Új parti
      </button>
    </div>
  );
}

// --------------------------------------------------------------- right rail

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
function Counters({
  state,
  side,
  viewer,
  bare,
  onTrack,
}: {
  state: GameState;
  side: PlayerId;
  viewer: PlayerId;
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
        {SIDE[side]}
        <b
          className="held-fields num"
          onMouseEnter={() => onTrack({ kind: "score", side })}
          onMouseLeave={() => onTrack(null)}
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
      onMouseLeave={() => track && onTrack(null)}
    >
      <b className="num">{count}</b>
    </span>
  );
}

/** What the ledger is currently showing. */
type Tracking =
  | { kind: "deck"; side: PlayerId; pile: "unit" | "spell" }
  | { kind: "grave"; side: PlayerId }
  | { kind: "score"; side: PlayerId };

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

function tryCard(id: string, kind: "unit" | "spell") {
  try {
    return kind === "unit" ? getUnit(id) : getSpell(id);
  } catch {
    return undefined;
  }
}

/**
 * The ledger: one panel down the middle of the right rail, between the two
 * players' piles, holding whichever one is being pointed at.
 *
 * It is the deck-tracker shape on purpose. A column of counted lines is how
 * anyone who plays these games already reads a pile, and it is the one place on
 * screen with room for a list that nothing has to clip.
 */
function Ledger({ state, tracking }: { state: GameState; tracking: Tracking | null }) {
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
        <b className="ledger-head">{SIDE[tracking.side]}: eddigi csaták</b>
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
      ? `${SIDE[tracking.side]}: temető`
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

// ------------------------------------------------------------------ overlays

/**
 * Whose turn it is and the one thing they may announce, floated just above the
 * near hand. It is the only chrome the board tolerates, so it stays to a line.
 */
function TurnCue(props: FieldProps & { moves: Action[]; viewer: PlayerId }) {
  const { state, actor, send, moves, fault, viewer } = props;
  const pending = state.resolution?.pending ?? null;
  const can = (type: Action["type"]) => moves.some((m) => m.type === type);
  const channel = state.channel[viewer];
  const enemyChannel = state.channel[other(viewer)];
  if (state.phase === "gameOver") return null;

  return (
    <div className="turn-cue">
      {fault && <span className="bad">{fault}</span>}

      {pending ? (
        <span className={`turn ${pending.player}`}>{pending.prompt}</span>
      ) : (
        actor &&
        (state.phase === "units" || state.phase === "battle") && (
          <>
            <span className={`turn ${actor}`}>
              {SIDE[actor]} lép, {state.phase === "units" ? "egységek" : "csata"}
            </span>
            {state.phase === "units"
              ? can("declareUnitsDone") && (
                  <button
                    className="tiny"
                    onClick={() => send({ type: "declareUnitsDone", player: actor })}
                  >
                    Egységek: kész
                  </button>
                )
              : can("declareSpellsDone") && (
                  <button
                    className="tiny"
                    onClick={() => send({ type: "declareSpellsDone", player: actor })}
                  >
                    Varázslatok: kész
                  </button>
                )}
          </>
        )
      )}

      {channel && <span className="channel mine">{getSpell(channel.cardId).name} készül</span>}
      {enemyChannel && <span className="channel theirs">Mesteri varázslat készül</span>}

      {state.phase === "scored" && (
        <>
          <span className="turn">{verdict(state)}</span>
          <button className="ember tiny" onClick={() => send({ type: "nextLocation" })}>
            Leszerelés
          </button>
        </>
      )}

      {/* Leszerelés, 12.5. Throwing cards away is optional and costs nothing to
          decline, so the only thing that has to be on screen is the way out. */}
      {state.phase === "cleanup" && actor && (
        <>
          <span className={`turn ${actor}`}>{SIDE[actor]} leszerel</span>
          {can("declareTossDone") && (
            <button
              className="ember tiny"
              onClick={() => send({ type: "declareTossDone", player: actor })}
            >
              Kész, húzz fel
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Chronicle({ state, onClose }: { state: GameState; onClose: () => void }) {
  const lines = state.log.filter((l) => l.location === state.locationIndex).slice(-80);
  return (
    <div className="chronicle-panel timber">
      <div className="rail-top">
        <b>Krónika</b>
        <button className="quiet tiny" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul className="chronicle">
        {lines.map((line, i) => (
          <li key={i}>
            {line.player && (
              <span className={`sigil ${line.player}`}>{line.player === "p1" ? "I" : "II"}</span>
            )}
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Aftermath({
  state,
  onLeave,
  onQuit,
}: {
  state: GameState;
  onLeave: () => void;
  onQuit: () => void;
}) {
  const played = state.locations.filter((l) => l.winner !== null);
  return (
    <div className="veilcloth">
      <div className="casket timber">
        <h2>
          {state.winner === "draw"
            ? "Döntetlen"
            : `${SIDE[state.winner as PlayerId]} játékos nyert`}
        </h2>
        <p className="tally" style={{ fontSize: 40 }}>
          <span className="p1">{state.scores.p1}</span>
          <span className="faint">:</span>
          <span className="p2">{state.scores.p2}</span>
        </p>
        <ul className="chronicle">
          {played.map((l, i) => (
            <li key={i}>
              <span className="faint num">{i + 1}.</span>
              <b>{getLocation(l.cardId).name}</b>
              {l.totals && (
                <span className="num dim">
                  {l.totals.p1}:{l.totals.p2}
                </span>
              )}
              <span className={l.winner === "void" ? "faint" : ""}>
                {l.winner === "void" ? "senkié" : SIDE[l.winner as PlayerId]}
              </span>
            </li>
          ))}
        </ul>
        <div className="tail">
          <span className="grow" />
          <button onClick={onQuit}>Új parti</button>
          <button className="ember" onClick={onLeave}>
            Menü
          </button>
        </div>
      </div>
    </div>
  );
}

function verdict(state: GameState): string {
  const here = state.locations[state.locationIndex];
  const t = here.totals;
  if (!t) return getLocation(here.cardId).name;
  if (here.winner === "void") return `${t.p1}:${t.p2}, senkié`;
  return `${SIDE[here.winner as PlayerId]} viszi, ${t.p1}:${t.p2}`;
}

// -------------------------------------------------------------------- hands

/**
 * The card you are pointing at, printed at readable size above the hand.
 *
 * A hand card is 110px wide and no amount of growing it in place was ever going
 * to make it legible: every version either ran off the bottom of the screen,
 * disappeared under the cards to its right, or moved the hover target and started
 * the whole thing flickering. So the readable copy is a separate, fixed overlay
 * that takes no pointer events, and the fan underneath does not move at all.
 *
 * It stands over its own card's place in the hand, which is why the position is
 * measured from the DOM rather than computed: the fan's geometry lives in CSS and
 * this only has to agree with wherever it ended up.
 */
function Reading({ uid, cardId }: { uid: string; cardId: string }) {
  const [x, setX] = useState<number | null>(null);

  useEffect(() => {
    const slot = document.querySelector(`[data-hand-uid="${uid}"]`);
    if (!slot) return;
    const box = slot.getBoundingClientRect();
    setX(box.left + box.width / 2);
  }, [uid]);

  if (x === null) return null;
  const card = cardFor(cardId);
  if (!card) return null;
  return (
    <div className="reading" style={{ "--read-x": `${x}px` } as React.CSSProperties}>
      <CardFace card={card} className={card.kind === "spell" ? "spell" : ""} />
    </div>
  );
}

/**
 * Where card `i` of `n` sits on the arc.
 *
 * Everything is handed over as a custom property, never as a finished `transform`
 * or a finished `z-index`. An inline value beats any rule the stylesheet could
 * write, and that was a real bug: the fan set `z-index` inline, so the hover rule
 * that was supposed to lift the hovered card above its neighbours never applied,
 * and a card on the left of the hand stayed buried under the ones to its right —
 * which is exactly where its power gem is.
 */
function arc(i: number, n: number, flip = false): React.CSSProperties {
  const mid = (n - 1) / 2;
  const offset = i - mid;
  const angle = offset * 4.5 * (flip ? -1 : 1);
  const drop = offset * offset * 2.6 * (flip ? -1 : 1);
  return {
    "--angle": `${angle}deg`,
    "--drop": `${drop}px`,
    "--z": 10 + i,
  } as React.CSSProperties;
}


/**
 * The enemy's hand: backs only, units on their left and spells on their right,
 * hanging off the top of the screen. The peek switch turns them over.
 */
function FarHand({
  state,
  player,
  bare,
}: {
  state: GameState;
  player: PlayerId;
  bare: boolean;
}) {
  const p = state.players[player];
  const groups: { cards: HandCard[]; kind: "unit" | "spell" }[] = [
    { cards: p.unitHand, kind: "unit" },
    { cards: p.spellHand, kind: "spell" },
  ];
  return (
    <div className="hand-rail far">
      {groups.map(({ cards, kind }) => (
        <div className="hand-group" key={kind}>
          {cards.map((c, i) => (
            <Slot key={c.uid} uid={c.uid} style={arc(i, cards.length, true)}>
              {bare ? (
                <CardFace
                  card={kind === "unit" ? getUnit(c.cardId) : getSpell(c.cardId)}
                  className={kind === "spell" ? "spell" : ""}
                />
              ) : (
                <span className={`cardback ${kind}`} />
              )}
            </Slot>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Your own hand, cut by the bottom of the screen until you reach for it. Units
 * sit on the left and spells on the right, and the half that cannot be played
 * this phase stays visible but dimmed: what you are holding in spells decides
 * where you put your units, so hiding it would hide the decision.
 */
function NearHand(
  props: FieldProps & {
    moves: Action[];
    viewer: PlayerId;
    onDrag: (event: React.PointerEvent, held: Held) => void;
    onRead: (uid: string | null) => void;
    /** The card currently in the air, drawn as a gap in the fan. */
    lifted: string | null;
  },
) {
  const { state, actor, held, setHeld, send, moves, viewer, onDrag, onRead, lifted } = props;
  const read = (uid: string) => (on: boolean) => onRead(on ? uid : null);
  const pending = state.resolution?.pending ?? null;
  const p = state.players[viewer];
  const mine = actor === viewer;
  const unitsPhase = state.phase === "units";
  const cleanup = state.phase === "cleanup";
  const channel = state.channel[viewer];

  const playable = new Set(
    moves.filter((m) => m.type === "playUnit").map((m) => (m as { uid: string }).uid),
  );
  // Leszerelés: every card in either hand is throwable, and none of it is forced.
  const discardable = new Set(
    moves.filter((m) => m.type === "toss").map((m) => (m as { uid: string }).uid),
  );
  const veilable = new Set(
    moves
      .filter((m) => m.type === "playUnit" && m.faceDown)
      .map((m) => (m as { uid: string }).uid),
  );
  const castable = new Set(
    moves.filter((m) => m.type === "castSpell").map((m) => (m as { uid: string }).uid),
  );
  const tossable = new Set(
    moves
      .filter((m) => m.type === "finishChannel")
      .map((m) => (m as { discardUid: string }).discardUid),
  );

  // A spell asking for a card out of hand takes over the hand entirely.
  if (pending?.kind === "handCard") {
    const options = pending.handOptions ?? [];
    return (
      <div className="hand-rail near">
        <div className="hand-group">
          {options.map((c, i) => (
            <Slot
              key={c.uid}
              uid={c.uid}
              style={arc(i, options.length)}
              playable
              onClick={() => send({ type: "chooseHandCard", player: pending.player, uid: c.uid })}
            >
              <CardFace card={getUnit(c.cardId)} />
            </Slot>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {held?.veiled && (
        <div className="toll">
          <span className="label">Ára, eldobott egységlap:</span>
          {p.unitHand
            .filter((c) => c.uid !== held.uid)
            .map((c) => (
              <button
                key={c.uid}
                className={held.tollUid === c.uid ? "tiny ember" : "tiny"}
                onClick={() => setHeld({ ...held, tollUid: c.uid })}
              >
                {getUnit(c.cardId).name}
              </button>
            ))}
          <button className="tiny quiet" onClick={() => setHeld({ ...held, veiled: false })}>
            mégsem fordítom
          </button>
        </div>
      )}

      {channel && mine && (
        <div className="toll">
          <span className="label">
            {getSpell(channel.cardId).name} befejezéséhez dobj el egy varázslatot.
          </span>
        </div>
      )}

      {cleanup && mine && (
        <div className="toll">
          <span className="label">
            Leszerelés: kattints bármelyik lapra, amit eldobsz. Nem kötelező eldobni semmit.
          </span>
        </div>
      )}

      <div className="hand-rail near">
        <div className={`hand-group${mine && (unitsPhase || cleanup) ? "" : " muted"}`}>
          {p.unitHand.map((c, i) => {
            const card: UnitCard = getUnit(c.cardId);
            const live = mine && unitsPhase && playable.has(c.uid);
            const toss = mine && cleanup && discardable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, p.unitHand.length)}
                playable={live || toss}
                picked={held?.uid === c.uid}
                lifted={lifted === c.uid}
                onRead={read(c.uid)}
                onClick={
                  toss
                    ? () => send({ type: "toss", player: viewer, uid: c.uid })
                    : live
                      ? () =>
                          setHeld(
                            held?.uid === c.uid
                              ? null
                              : { uid: c.uid, veiled: false, tollUid: null },
                          )
                      : undefined
                }
                // Pick the card up and drop it on a tile. Selecting the card is
                // the same thing a click does, so the tiles light up either way
                // and the two ways of playing share one code path.
                onDragStart={
                  live
                    ? (e) => onDrag(e, { uid: c.uid, veiled: false, tollUid: null })
                    : undefined
                }
              >
                <CardFace card={card} />
                {live && veilable.has(c.uid) && (
                  <button
                    className="veil-tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      const toll = p.unitHand.find((x) => x.uid !== c.uid);
                      setHeld({ uid: c.uid, veiled: true, tollUid: toll?.uid ?? null });
                    }}
                  >
                    fordít
                  </button>
                )}
              </Slot>
            );
          })}
        </div>

        <div className={`hand-group${mine && !unitsPhase ? "" : " muted"}`}>
          {p.spellHand.map((c, i) => {
            const card: SpellCard = getSpell(c.cardId);
            const feed = mine && tossable.has(c.uid);
            const cast = mine && !channel && castable.has(c.uid);
            const drop = mine && cleanup && discardable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                uid={c.uid}
                style={arc(i, p.spellHand.length)}
                playable={feed || cast || drop}
                lifted={lifted === c.uid}
                onRead={read(c.uid)}
                dead={mine && !unitsPhase && !cleanup && !feed && !cast}
                onClick={
                  drop
                    ? () => send({ type: "toss", player: viewer, uid: c.uid })
                    : feed
                      ? () => send({ type: "finishChannel", player: viewer, discardUid: c.uid })
                      : cast
                        ? () => send({ type: "castSpell", player: viewer, uid: c.uid })
                        : undefined
                }
              >
                <CardFace card={card} className="spell" />
                {isMasterSpell(card) && <span className="master-tag">Mesteri</span>}
              </Slot>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * One card in a hand.
 *
 * The wrapper is a fixed box that never moves, and everything that animates —
 * the fan angle, the neighbourly shove, the hover lift — happens on the card
 * inside it. That split is the whole point: a hovered card that lifts 130px and
 * grows a third leaves the pointer behind if the card is itself the hover
 * target, so the card drops, catches the pointer again, and lifts, forever. With
 * the box fixed, the hover region is the box plus wherever the card has got to
 * (`:hover` on an ancestor holds while the pointer is over any descendant), and
 * neither of those moves while the pointer sits still.
 */
function Slot({
  style,
  playable,
  picked,
  dead,
  lifted,
  onClick,
  onDragStart,
  onRead,
  children,
  uid,
}: {
  style: React.CSSProperties;
  playable?: boolean;
  picked?: boolean;
  dead?: boolean;
  /** This card is in the air, so the fan shows the gap it left behind. */
  lifted?: boolean;
  onClick?: () => void;
  /** Set on cards that can be picked up and dropped onto a tile. */
  onDragStart?: (event: React.PointerEvent) => void;
  /** Pointer in, pointer out. Drives the full-size copy printed above the hand. */
  onRead?: (reading: boolean) => void;
  children: React.ReactNode;
  /** Lets the flight layer find this card's corner on screen. */
  uid?: string;
}) {
  const classes = ["hand-slot"];
  if (playable) classes.push("playable");
  if (picked) classes.push("picked");
  if (dead) classes.push("dead");
  if (lifted) classes.push("lifted");
  if (onDragStart) classes.push("draggable");
  return (
    <div
      className={classes.join(" ")}
      style={style}
      data-hand-uid={uid}
      onPointerDown={onDragStart}
      onPointerEnter={() => onRead?.(true)}
      onPointerLeave={() => onRead?.(false)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="hand-card">{children}</span>
    </div>
  );
}
