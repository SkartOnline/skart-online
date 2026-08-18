import "./game.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAction, createGame, legalActions } from "../../engine";
import type { Action, GameState, PlayerId, SlotId } from "../../engine";
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
import type { BeatKind, Flight } from "./theatre";
import { other } from "./common";
import type { FieldProps, Held, LiveBeat } from "./common";
import Theatre from "./TheatreView";
import { Battlefield, Annals, Tools, TurnCue } from "./LeftRail";
import { Counters, Ledger } from "./RightRail";
import type { Tracking } from "./RightRail";
import { FarHand, NearHand, Reading } from "./Hands";
import { Chronicle, Aftermath } from "./Overlays";

/**
 * The game screen's orchestrator: game state, undo history, the beat stream the
 * theatre plays, the bot's timer and the drag session. Everything visual lives
 * in its own file — `Theatre`, `LeftRail`, `RightRail`, `Hands`, `Overlays` —
 * and shares the `FieldProps` shape from `common.ts`.
 */

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
  /**
   * Which pile the ledger is holding open.
   *
   * It stays on whatever you last pointed at rather than emptying when the
   * pointer leaves. A panel that clears itself the moment you move away cannot be
   * scrolled at all — and a thirty-card deck listing on a short screen is exactly
   * the thing you need to scroll. Pointing at another pile replaces it.
   */
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
    // Leszerelés is book-keeping, not a move worth watching: the machine says it
    // is done and the battle turns over. Everything else waits long enough for
    // the previous beat to finish, because a card leaving its hand is the only
    // sign it did anything.
    const busy = beats.some((b) => b.kind === "land" || b.kind === "veil" || b.kind === "cast");
    const pause = state.phase === "cleanup" ? 120 : busy ? 950 : 620;
    const timer = setTimeout(() => {
      const action = bot.current?.choose(state, botSide!);
      if (action) send(action);
    }, pause);
    return () => clearTimeout(timer);
  }, [botToMove, state, botSide, bot, send, beats]);

  // The scored step has nothing to decide: the totals are in, Diadal and Vigasz
  // have fired, and leszerelés follows. So it follows on its own, after long
  // enough to read the result. Pressing a button to acknowledge arithmetic is not
  // a turn.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (state.phase !== "scored") return;
    const timer = setTimeout(() => sendRef.current({ type: "nextLocation" }), 2200);
    return () => clearTimeout(timer);
    // Deliberately keyed to the battle rather than to the whole state: beats
    // expiring re-render this component, and a timer that restarted on every
    // render would keep pushing the step further away for as long as anything
    // was still animating.
  }, [state.phase, state.locationIndex]);

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
        <span className="rail-gap" />
        <Tools {...props} onLog={() => setLogOpen((v) => !v)} logOpen={logOpen} />
      </aside>

      {/* A thin strip of pictures beside the left rail, clear of everything the
          rail has to be clickable for. */}
      <Annals state={state} viewer={viewer} />

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
