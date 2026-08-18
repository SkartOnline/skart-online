import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  announcedBattlefields,
  legalActions,
  newReveals,
  trapSlots,
  pendingPrompt,
  promptSatisfied,
  remainingCap,
  slotsOf,
  visibleCapSpent,
  visibleTotal,
} from "../../engine";
import type {
  Action,
  GameState,
  HandCard,
  LocationCard,
  PlayerId,
  Prompt,
  Reveal,
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
  REVEAL_MS,
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
  /** Cards a player has been shown: a peek, a tutor, a trap going off. */
  const [shows, setShows] = useState<LiveReveal[]>([]);
  /**
   * The clock the theatre reads.
   *
   * Beats no longer all start at once. A death waits for the play that caused
   * it, which means a beat has a moment it *begins* as well as one it ends, and
   * something has to re-render the screen when that moment arrives. This is
   * that something: the timer moves it forward, and everything derived from it
   * — which tiles are stirring, what the banner says — falls out.
   */
  const [now, setNow] = useState(() => Date.now());
  /**
   * Whether the opening ceremony is still running. Nothing may move while it
   * is: the point of it is that the first thing you see is not a board the
   * machine has already played onto.
   */
  const [prologue, setPrologue] = useState(true);
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
      setShows([]);
      setPrologue(true);
    } catch (e) {
      setFault(String(e));
    }
  }

  /**
   * One action, or a run of them that a single gesture produced.
   *
   * Dragging Fuedrax's trap out of the hand and onto a tile answers two
   * questions at once — which spell, and where — and they cannot be two calls,
   * because both would apply to the same stale state. They are folded here
   * instead, and the theatre reads the difference across the whole run, so the
   * gesture reads as the one thing it was.
   */
  function send(action: Action | Action[]) {
    if (!state) return;
    const run = Array.isArray(action) ? action : [action];
    if (run.length === 0) return;
    try {
      // The card has to be cloned while it still exists in the hand, which is
      // now: applying the action is what takes it away.
      const first = run[0];
      if (first.type === "playUnit" || first.type === "castSpell") {
        const flight = captureHandCard(first.uid);
        if (flight) {
          pendingFlight.current = {
            flight,
            slot: first.type === "playUnit" ? first.slot : undefined,
          };
        }
      }
      const next = run.reduce(applyAction, state);
      const at = Date.now();
      setPast((h) => [...h.slice(-40), state]);
      setBeats((b) => [
        ...b,
        ...beatsBetween(state, next).map((beat) => ({
          ...beat,
          startsAt: at + beat.at,
          expiresAt: at + beat.at + BEAT_MS[beat.kind],
        })),
      ]);
      // A reveal waits for the card that caused it to be on screen: Fejvadász
      // has to be down and readable before the hand he is going through opens.
      setShows((s) => [
        ...s,
        ...newReveals(state, next).map((reveal, i) => ({
          ...reveal,
          startsAt: at + 520 + i * 220,
          expiresAt: at + 520 + i * 220 + REVEAL_MS,
        })),
      ]);
      setNow(at);
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
      if (beat.startsAt > Date.now()) continue;
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

  /**
   * One timer for the whole theatre, aimed at the next moment anything changes:
   * a beat starting, a beat ending, a reveal going up or coming down. Each of
   * them carries its own two deadlines, so a new batch arriving never extends
   * the life of an old one, and a beat that has not started yet is simply not
   * shown until its moment comes.
   */
  useEffect(() => {
    if (beats.length === 0 && shows.length === 0) return;
    const t = Date.now();
    const marks = [
      ...beats.flatMap((b) => [b.startsAt, b.expiresAt]),
      ...shows.flatMap((s) => [s.startsAt, s.expiresAt]),
    ].filter((mark) => mark > t);
    const soonest = marks.length > 0 ? Math.min(...marks) : t;
    const timer = setTimeout(
      () => {
        const at = Date.now();
        setNow(at);
        setBeats((current) => current.filter((b) => b.expiresAt > at));
        setShows((current) => current.filter((s) => s.expiresAt > at));
      },
      Math.max(16, soonest - t),
    );
    return () => clearTimeout(timer);
  }, [beats, shows, now]);

  // Stable, because the ceremony's own timer has it in a dependency list and a
  // new identity every render would restart the act it is in the middle of.
  const endPrologue = useCallback(() => setPrologue(false), []);

  function stepBack() {
    setPast((h) => {
      if (h.length === 0) return h;
      setState(h[h.length - 1]);
      setHeld(null);
      setBeats([]);
      setShows([]);
      return h.slice(0, -1);
    });
  }

  if (!state) return <NewGame onStart={begin} onLeave={onLeave} />;


  const asking = pendingPrompt(state);
  const pending = state.resolution?.pending ?? null;
  // An ability waiting on a pick answers before anything else, and not
  // necessarily on its own turn: a battlefield that hands both players a tutor
  // asks the second one while the first still holds the turn.
  const actor: PlayerId | null = asking
    ? asking.player
    : pending
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
      shows={shows}
      now={now}
      prologue={prologue}
      endPrologue={endPrologue}
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

/** A beat plus the two moments that bracket it on screen. */
type LiveBeat = Beat & { startsAt: number; expiresAt: number };

/** A reveal plus the same bracket. */
type LiveReveal = Reveal & { startsAt: number; expiresAt: number };

interface FieldProps {
  state: GameState;
  actor: PlayerId | null;
  /** The seat the machine is playing, or `null` for hotseat. */
  botSide: PlayerId | null;
  bot: React.MutableRefObject<Agent | null>;
  /** What just happened, for the theatre to show. Never read for rules. */
  beats: LiveBeat[];
  /** What a player has been shown: a peeked card, a tutor, a trap going off. */
  shows: LiveReveal[];
  /** The theatre's clock. Everything timed is derived from it, never from Date. */
  now: number;
  /** The opening ceremony is still playing. Nothing else may move until it is not. */
  prologue: boolean;
  endPrologue: () => void;
  held: Held | null;
  setHeld: (h: Held | null) => void;
  send: (a: Action | Action[]) => void;
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
  const { state, actor, held, setHeld, send, bare, botSide, bot, now } = props;
  // Only the beats whose moment has come. A beat that has not started yet is
  // already in the queue — it has to be, the diff that produced it is gone —
  // but nothing on screen may know about it until the clock reaches it.
  const beats = useMemo(
    () => props.beats.filter((b) => b.startsAt <= now),
    [props.beats, now],
  );
  const shows = useMemo(
    () => props.shows.filter((s) => s.startsAt <= now),
    [props.shows, now],
  );
  const asking = pendingPrompt(state);
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
  // A reveal holds the camera where it is.
  //
  // Without this, hotseat could never show one at all: playing Mágusinkvizítor
  // is what turns the table, so the card he pulled out of the enemy's hand
  // would come up on screen a frame after the seat it belongs to had already
  // been handed over — the peeker's own ability, shown to the player it was
  // used against. The table turns when the reveal is finished instead.
  // A live question outranks a fading reveal: whoever is being asked something
  // has to be looking at their own half while they answer it.
  const peeking = shows.length > 0 ? shows[shows.length - 1].player : null;
  const viewer: PlayerId = human ?? asking?.player ?? peeking ?? actor ?? state.turn;
  const far = other(viewer);

  // The machine moves on a timer rather than instantly, so its turn is something
  // you watch happen instead of a board that has already changed. The wait is
  // long enough for the previous beat to finish playing: a card flying out of the
  // machine's hand is the only signal that it did anything at all.
  const botToMove =
    botSide !== null && actor === botSide && state.phase !== "gameOver" && !props.prologue;
  useEffect(() => {
    if (!botToMove || !bot.current) return;
    // Leszerelés is book-keeping, not a move worth watching: the machine says it
    // is done and the battle turns over.
    //
    // Everything else waits for the theatre to finish. That is stronger than it
    // used to be, and it has to be: beats no longer all start at once, so a
    // death that has not begun playing yet is still owed its moment, and a
    // machine that moved as soon as the *first* beat was over would talk over
    // the consequences of its own last move. Draws and tosses are exempt —
    // watching a hand refill is not watching a turn.
    const quiet = Math.max(
      0,
      ...props.beats
        .filter((b) => b.kind !== "draw" && b.kind !== "toss")
        .map((b) => b.expiresAt - Date.now()),
      ...props.shows.map((s) => s.expiresAt - Date.now()),
    );
    const pause = state.phase === "cleanup" ? 120 : Math.max(560, quiet + 240);
    const timer = setTimeout(() => {
      const action = bot.current?.choose(state, botSide!);
      if (action) send(action);
    }, pause);
    return () => clearTimeout(timer);
  }, [botToMove, state, botSide, bot, send, props.beats, props.shows]);

  // The scored step has nothing to decide: the totals are in, Diadal and Vigasz
  // have fired, and leszerelés follows. So it follows on its own, after long
  // enough to read the result. Pressing a button to acknowledge arithmetic is not
  // a turn.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (state.phase !== "scored") return;
    const timer = setTimeout(() => sendRef.current({ type: "nextLocation" }), 3600);
    return () => clearTimeout(timer);
    // Deliberately keyed to the battle rather than to the whole state: beats
    // expiring re-render this component, and a timer that restarted on every
    // render would keep pushing the step further away for as long as anything
    // was still animating.
  }, [state.phase, state.locationIndex]);

  const moves = useMemo(() => (actor ? legalActions(state, actor) : []), [state, actor]);

  const open = useMemo(() => {
    const set = new Set<SlotId>();
    // Fuedrax naming the tile his trap watches. Same mechanism as a spell's
    // target pick, so the tile lights up and takes a drop the same way.
    if (asking?.picking === "slot") {
      for (const slot of asking.slots ?? []) set.add(slot);
      return set;
    }
    // The tiles are lit while the spell is still in hand, too, so burying one is
    // the gesture the card describes — pick it up, drop it over there — rather
    // than a click here followed by a click there. The two answers travel as one
    // run of actions.
    if (asking?.kind === "trapSpell") {
      for (const slot of trapSlots(state, asking.player)) set.add(slot);
      return set;
    }
    if (asking) return set;
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
  }, [state, state.phase, asking, pending, held, moves]);

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
    if (asking?.picking === "slot") {
      send({ type: "answerPrompt", player: asking.player, pick: slot });
      return;
    }
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
  /**
   * Burying Fuedrax's trap: pick the spell up, drop it on the tile it will
   * watch. Two answers, one gesture, so they go as one run of actions — sent
   * separately they would both land on the same stale state.
   */
  function startTrapDrag(event: React.PointerEvent, uid: string) {
    if (event.button !== 0 || !asking || asking.kind !== "trapSpell") return;
    const player = asking.player;
    const session = beginCardDrag(uid, event.nativeEvent, {
      onDrop: (slot) =>
        send([
          { type: "answerPrompt", player, pick: uid },
          { type: "answerPrompt", player, pick: slot },
        ]),
      onEnd: () => setLifted(null),
    });
    if (!session) return;
    event.preventDefault();
    setLifted(uid);
  }

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
          onDragTrap={startTrapDrag}
          onRead={setReading}
          lifted={liftedStillHeld}
        />
      )}

      {/* The card under the pointer, printed at full size above its own place in
          the fan. Nothing in the hand moves to make this happen. */}
      {readCard && !liftedStillHeld && <Reading uid={readCard.uid} cardId={readCard.cardId} />}

      {/* An ability going through a pile: the deck a tutor is searching, the
          hand Griff is helping himself to. A hand of your own is picked from
          the hand itself, so only the piles reach this panel. */}
      {asking && !handHeld(asking, state) && asking.picking === "card" && (
        <Almanac prompt={asking} send={send} />
      )}

      {/* What somebody has just been shown, held up long enough to read. */}
      <Curtain shows={shows} viewer={viewer} bare={bare} />

      {props.prologue && <Prologue state={state} onDone={props.endPrologue} />}

      {logOpen && <Chronicle state={state} onClose={() => setLogOpen(false)} />}
      {over && <Aftermath state={state} onLeave={props.onLeave} onQuit={props.onQuit} />}
    </div>
  );
}

/**
 * Is this prompt asking about cards the player is already holding?
 *
 * It decides where the question is put. Cards in your own hand are picked out
 * of the hand — that is where they are, and clicking one there is what anyone
 * would try first. Anything else is a pile nobody can see: a deck being
 * searched, a graveyard being read, an opponent's hand Griff has opened. Those
 * have nowhere on screen to be, so they get a panel of their own.
 */
function handHeld(prompt: Prompt, state: GameState): boolean {
  if (prompt.picking !== "card") return false;
  const mine = new Set(
    [...state.players[prompt.player].unitHand, ...state.players[prompt.player].spellHand].map(
      (c) => c.uid,
    ),
  );
  return (prompt.cards ?? []).every((c) => mine.has(c.uid));
}

// --------------------------------------------------------------- the almanac

/**
 * A pile, opened, with the cards in it there to be pointed at.
 *
 * This is the ledger's shape on purpose. A column of counted lines is how
 * anyone who plays these games already reads a pile, the right rail already
 * teaches it, and a tutor is exactly the moment you want that reading to be
 * clickable rather than only legible. Pointing at a line prints the whole card
 * beside it, because a name and a cost is not enough to choose on.
 *
 * Copies are counted the way the ledger counts them — four rats are one line
 * reading ×4 — but a pick still names a single card, so the line keeps the uid
 * of the next unpicked copy and hands that over.
 */
function Almanac({ prompt, send }: { prompt: Prompt; send: (a: Action) => void }) {
  const [reading, setReading] = useState<string | null>(null);
  const picked = new Set(prompt.chosen);
  const cards = prompt.cards ?? [];
  const left = prompt.max - prompt.chosen.length;

  const lines = new Map<string, { cardId: string; uids: string[] }>();
  for (const card of cards) {
    const found = lines.get(card.cardId);
    if (found) found.uids.push(card.uid);
    else lines.set(card.cardId, { cardId: card.cardId, uids: [card.uid] });
  }
  const rows = [...lines.values()]
    .map((line) => ({
      ...line,
      card: cardFor(line.cardId),
      free: line.uids.filter((uid) => !picked.has(uid)),
    }))
    .filter((row) => !!row.card)
    .sort(
      (a, b) =>
        (a.card!.kind === b.card!.kind ? 0 : a.card!.kind === "unit" ? -1 : 1) ||
        ("cost" in a.card! ? a.card!.cost : 0) - ("cost" in b.card! ? b.card!.cost : 0) ||
        a.card!.name.localeCompare(b.card!.name, "hu"),
    );

  const shown = reading ? cardFor(reading) : undefined;
  const chosenNames = prompt.chosen
    .map((uid) => cards.find((c) => c.uid === uid)?.cardId)
    .map((id) => (id ? (cardFor(id)?.name ?? id) : ""))
    .filter(Boolean);

  return (
    <div className="almanac timber">
      <div className="almanac-head">
        <b>{prompt.prompt}</b>
        <span className="num">
          {prompt.chosen.length}/{prompt.max}
        </span>
      </div>

      <ul className="almanac-list">
        {rows.length === 0 && <li className="faint">Nincs több választható lap.</li>}
        {rows.map((row) => {
          const card = row.card!;
          const spent = row.free.length === 0;
          return (
            <li
              key={row.cardId}
              className={`almanac-row ${card.kind === "spell" ? "spell" : "unit"}${
                spent ? " spent" : ""
              }`}
              onMouseEnter={() => setReading(row.cardId)}
              onMouseLeave={() => setReading(null)}
            >
              <button
                disabled={spent || left <= 0}
                onClick={() =>
                  send({ type: "answerPrompt", player: prompt.player, pick: row.free[0] })
                }
              >
                <span className="ledger-cost num">{"cost" in card ? card.cost : ""}</span>
                <span className="ledger-name">{card.name}</span>
                {row.uids.length > 1 && (
                  <span className="ledger-count num">
                    ×{row.free.length}/{row.uids.length}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="almanac-foot">
        {chosenNames.length > 0 && <span className="almanac-picked">{chosenNames.join(", ")}</span>}
        <span className="grow" />
        {/* Only offered once the ability has had what it insists on. A tutor
            that says one card comes up has no way out but to name one. */}
        {promptSatisfied(prompt) && (
          <button
            className="ember tiny"
            onClick={() => send({ type: "finishPrompt", player: prompt.player })}
          >
            {prompt.chosen.length === 0 ? "Kihagyom" : "Kész"}
          </button>
        )}
      </div>

      {shown && (
        <div className="almanac-card">
          <CardFace card={shown} className={shown.kind === "spell" ? "spell" : ""} />
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- the curtain

/**
 * A card somebody has been shown.
 *
 * Three of these abilities — Gréta, Mágusinkvizítor, Leskelődés — used to write
 * a line in the chronicle and stop, on the grounds that hotseat has a "Mindent
 * mutat" switch. A switch you could have flicked yourself is not an ability, so
 * what they produce now is this: the card comes up out of the far hand, is held
 * long enough to actually read, and goes back where it came from.
 *
 * Fejvadász is the one with a verdict on it. His whole ability is the moment
 * between the card turning over and the cost being read, so the card says which
 * way it went: a green ring and a lean forward when it beat him, and a flat
 * refusal when it did not.
 *
 * Nobody but the player entitled to look ever sees any of it. The record
 * carries whose look it was, which is what keeps a bot peeking at a hand from
 * showing that hand to the person it is playing against.
 */
function Curtain({
  shows,
  viewer,
  bare,
}: {
  shows: (Reveal & { startsAt: number; expiresAt: number })[];
  viewer: PlayerId;
  bare: boolean;
}) {
  const shown = [...shows].reverse().find((s) => s.open || s.player === viewer || bare);
  if (!shown) return null;

  const cards = shown.cardIds
    .map((id) => cardFor(id) ?? tryLocation(id))
    .filter((card): card is UnitCard | SpellCard | LocationCard => !!card);
  if (cards.length === 0) return null;

  return (
    <div key={shown.id} className={`curtain ${shown.kind}${shown.verdict ? ` ${shown.verdict}` : ""}`}>
      <span className="curtain-note">{curtainNote(shown)}</span>
      <div className="curtain-cards">
        {cards.slice(0, 7).map((card, i) => (
          <div className="curtain-card" key={i} style={{ "--nth": i } as React.CSSProperties}>
            <CardFace card={card} className={isSpellCard(card) ? "spell" : ""} />
          </div>
        ))}
      </div>
      {shown.verdict && (
        <span className={`curtain-verdict ${shown.verdict}`}>{verdictWord(shown)}</span>
      )}
    </div>
  );
}

function curtainNote(reveal: Reveal): string {
  if (reveal.text) return reveal.text;
  if (reveal.kind === "tutor") return "kikeresve";
  if (reveal.kind === "portal") return "portál a következő csatatérre";
  if (reveal.kind !== "trap") return "felfedve";
  if (reveal.verdict === undefined) return "csapda lehelyezve";
  const victim = reveal.subjectCardId ? cardFor(reveal.subjectCardId)?.name : undefined;
  return victim ? `${victim} csapdába lép` : "csapda";
}

/**
 * The same two verdicts mean different things on different cards, so they are
 * worded for the card that produced them: Fejvadász is asking whether what came
 * out of the hand cost more than he did, a trap is asking whether the spell it
 * was holding could touch whoever walked in.
 */
function verdictWord(reveal: Reveal): string {
  if (reveal.kind === "trap") return reveal.verdict === "yes" ? "elsül" : "elszáll";
  return reveal.verdict === "yes" ? "drágább" : "nem elég";
}

function tryLocation(id: string): LocationCard | undefined {
  try {
    return getLocation(id);
  } catch {
    return undefined;
  }
}

function isSpellCard(card: UnitCard | SpellCard | LocationCard): boolean {
  return (card as SpellCard).kind === "spell";
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
              {/* The rules box, not only the name. A battlefield changes what
                  every tile on the board is worth, and a player who has not
                  memorised fifteen of them cannot fight on one they were only
                  told the name of. */}
              {locationText(frame.cardId) && <i>{locationText(frame.cardId)}</i>}
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

function locationText(id: string | undefined): string {
  if (!id) return "";
  try {
    return getLocation(id).text ?? "";
  } catch {
    return "";
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

// ------------------------------------------------------------------ prologue

/**
 * What happens before a card is played.
 *
 * The game used to open on a board that was already running: the first
 * battlefield was decided, drawn in the rail, and the machine had usually taken
 * its opening turn before the fade-in had finished. Everything that makes the
 * first minute of a game legible — who brought what, which of the six came up,
 * what it does to the board you are about to fight on — happened off screen.
 *
 * So it happens on screen, in four acts, and nothing else may move until they
 * are over. The order is the order a table would do it in: show the six boards
 * both players brought, turn them face down, shuffle them where everyone can
 * see, and turn the top one over.
 *
 * The draw is theatre only. `createGame` shuffled the locations before this
 * component existed and the answer is already sitting in `state.locations[0]`,
 * which is exactly why the shuffle can be shown at all: nothing here decides
 * anything, so nothing here can get it wrong.
 */
const ACTS = ["roster", "shuffle", "crown"] as const;
type Act = (typeof ACTS)[number];

const ACT_MS: Record<Act, number> = {
  // Long enough to read six names and see who brought which.
  roster: 4200,
  shuffle: 3200,
  // Long enough to read a cap and a rules box on a battlefield you have never
  // seen, which is the whole reason this screen exists.
  crown: 4800,
};

function Prologue({ state, onDone }: { state: GameState; onDone: () => void }) {
  const [act, setAct] = useState<Act>("roster");

  useEffect(() => {
    const index = ACTS.indexOf(act);
    const timer = setTimeout(() => {
      if (index + 1 < ACTS.length) setAct(ACTS[index + 1]);
      else onDone();
    }, ACT_MS[act]);
    return () => clearTimeout(timer);
  }, [act, onDone]);

  const brought = announcedBattlefields(state);
  const first = state.locations[0];
  const card = tryLocation(first.cardId);

  return (
    // Clicking anywhere skips the rest. Anyone who has seen it once has seen it.
    <div className={`prologue ${act}`} onClick={onDone}>
      {act !== "crown" && (
        <div className="prologue-sides">
          {(["p1", "p2"] as PlayerId[]).map((side) => (
            <div className={`prologue-side ${side}`} key={side}>
              <b>{SIDE[side]}</b>
              <span className="prologue-brings">három csatateret hoz</span>
              <ul className="prologue-fan">
                {brought
                  .filter((bf) => bf.broughtBy === side)
                  .map((bf, i) => (
                    <li key={bf.id} style={{ "--nth": i } as React.CSSProperties}>
                      {act === "roster" ? (
                        <CardFace card={bf} className="battlefield" />
                      ) : (
                        <span className="cardback location" />
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {act === "shuffle" && <span className="prologue-word">keverés</span>}

      {act === "crown" && card && (
        <div className="prologue-crown">
          <span className="prologue-word">az első csatatér</span>
          <CardFace card={card} className="battlefield" />
          <div className="prologue-writ">
            <b>{card.name}</b>
            <span className="num">keret {card.cap === null ? "∞" : card.cap}</span>
            {card.text && <em>{card.text}</em>}
            <span className="faint">
              {SIDE[first.broughtBy]} hozta, {SIDE[first.broughtBy]} kezd
            </span>
          </div>
        </div>
      )}

      <span className="prologue-skip">kattints az átugráshoz</span>
    </div>
  );
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
 * The battle so far, as a thin column of pictures beside the board.
 *
 * Pictures only. A name beside each one made the strip wide enough to sit over
 * the rail's buttons and swallow their clicks, and the picture is the part that
 * reads at a glance anyway — the whole reason to have this next to a text
 * chronicle is that a column of images is scannable and a column of sentences is
 * not. Pointing at one prints the card beside it.
 *
 * There is no card art in the set yet, so each entry draws an empty frame in the
 * right shape and colour and fills itself in the moment `artFor` returns
 * something.
 */
function Annals({ state, viewer }: { state: GameState; viewer: PlayerId }) {
  const [open, setOpen] = useState<string | null>(null);
  const entries: { key: string; owner: PlayerId; cardId: string; kind: "unit" | "spell" }[] = [];

  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    // A face-down unit is not named anywhere, including here.
    if (!unit || unit.faceDown) continue;
    entries.push({ key: `u${unit.uid}`, owner: unit.owner, cardId: unit.cardId, kind: "unit" });
  }
  for (const cast of state.spellsCast) {
    entries.push({ key: `s${cast.uid}`, owner: cast.owner, cardId: cast.cardId, kind: "spell" });
  }

  const shown = open ? cardFor(open) : undefined;

  return (
    <div className="annals" key={state.locationIndex}>
      <ul className="annals-list">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`annal ${entry.kind} ${entry.owner === viewer ? "mine" : "theirs"}`}
            onMouseEnter={() => setOpen(entry.cardId)}
            onMouseLeave={() => setOpen(null)}
            title={cardFor(entry.cardId)?.name ?? ""}
          >
            {artFor(entry.cardId) && <img src={artFor(entry.cardId)} alt="" />}
          </li>
        ))}
      </ul>
      {shown && (
        <div className="annal-card">
          <CardFace card={shown} className={shown.kind === "spell" ? "spell" : ""} />
        </div>
      )}
    </div>
  );
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
  const asking = pendingPrompt(state);
  const pending = state.resolution?.pending ?? null;
  const can = (type: Action["type"]) => moves.some((m) => m.type === type);
  const channel = state.channel[viewer];
  const enemyChannel = state.channel[other(viewer)];
  if (state.phase === "gameOver") return null;

  return (
    <div className="turn-cue">
      {fault && <span className="bad">{fault}</span>}

      {asking ? (
        <>
          <span className={`turn ${asking.player}`}>
            {SIDE[asking.player]}: {asking.prompt}
          </span>
          {/* The one way out of a question that allows one. Its twin lives on
              whichever surface is holding the cards, so both are reachable
              wherever the player's eyes already are. */}
          {promptSatisfied(asking) && asking.picking === "slot" && (
            <button
              className="tiny"
              onClick={() => send({ type: "finishPrompt", player: asking.player })}
            >
              Kihagyom
            </button>
          )}
        </>
      ) : pending ? (
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

      {state.phase === "scored" && <span className="turn">{verdict(state)}</span>}

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
    /** Only for Fuedrax's trap, where the drop tile is the second answer. */
    onDragTrap: (event: React.PointerEvent, uid: string) => void;
    onRead: (uid: string | null) => void;
    /** The card currently in the air, drawn as a gap in the fan. */
    lifted: string | null;
  },
) {
  const { state, actor, held, setHeld, send, moves, viewer, onDrag, onDragTrap, onRead, lifted } =
    props;
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

  // An ability going through your own hand — Griff paying back what he took,
  // Fuedrax choosing what to bury — takes the hand over. It belongs here rather
  // than in a panel: the cards are already in front of you, and pointing at one
  // where it lies is what anyone tries first.
  const asking = pendingPrompt(state);
  if (asking && asking.player === viewer && handHeld(asking, state)) {
    const options = asking.cards ?? [];
    const picked = new Set(asking.chosen);
    return (
      <>
        <div className="toll">
          <span className="label">
            {asking.prompt}
            {asking.max > 1 && (
              <b className="num">
                {" "}
                {asking.chosen.length}/{asking.max}
              </b>
            )}
          </span>
          {promptSatisfied(asking) && (
            <button
              className="ember tiny"
              onClick={() => send({ type: "finishPrompt", player: asking.player, })}
            >
              {asking.chosen.length === 0 ? "Kihagyom" : "Kész"}
            </button>
          )}
        </div>
        <div className="hand-rail near">
          <div className="hand-group">
            {options.map((c, i) => {
              const card = cardFor(c.cardId);
              if (!card) return null;
              const taken = picked.has(c.uid);
              return (
                <Slot
                  key={c.uid}
                  uid={c.uid}
                  style={arc(i, options.length)}
                  playable={!taken}
                  picked={taken}
                  lifted={lifted === c.uid}
                  onRead={read(c.uid)}
                  onClick={
                    taken
                      ? undefined
                      : () => send({ type: "answerPrompt", player: asking.player, pick: c.uid })
                  }
                  // Fuedrax is the one prompt where the card has somewhere to
                  // go, so it can be carried there. Clicking still works and
                  // asks for the tile afterwards.
                  onDragStart={
                    asking.kind === "trapSpell" && !taken
                      ? (e) => onDragTrap(e, c.uid)
                      : undefined
                  }
                >
                  <CardFace card={card} className={isSpellCard(card) ? "spell" : ""} />
                </Slot>
              );
            })}
          </div>
        </div>
      </>
    );
  }

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
