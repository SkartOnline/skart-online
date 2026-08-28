import "./game.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createGame,
  legalActions,
  newReveals,
  pendingPrompt,
  trapSlots,
} from "../../engine";
import type { Action, GameState, PlayerId, SlotId } from "../../engine";
import Board, { Loaded } from "./Board";
import NewGame from "./NewGame";
import type { Sides } from "./NewGame";
import { makeBot } from "./bot";
import type { Opponent } from "./bot";
import {
  ambienceFor,
  anchorRect,
  BEAT_MS,
  beatsBetween,
  beginCardDrag,
  boardAsOf,
  captureHandCard,
  flyBack,
  flyTo,
  matchSounds,
  REVEAL_MS,
  slotElement,
  soundFor,
} from "./theatre";
import { playAmbience, playSound, preloadSounds, stopAmbience } from "../audio";
import type { BeatKind, Flight } from "./theatre";
import { cardFor, handHeld, other } from "./common";
import type { FieldProps, Held, LiveBeat, LiveReveal } from "./common";
import Theatre from "./TheatreView";
import { Battlefield, Annals, Tools, TurnCue } from "./LeftRail";
import { Counters, Ledger } from "./RightRail";
import type { Tracking } from "./RightRail";
import { FarHand, NearHand, Reading } from "./Hands";
import { Almanac, Coin, Curtain, Disarming } from "./Asking";
import { Beacon, Spotlight } from "./Spotlight";
import Prologue from "./Prologue";
import { Chronicle, Aftermath } from "./Overlays";

/**
 * The game screen's orchestrator: game state, undo history, the beat and
 * reveal streams the theatre plays, the opening ceremony, the bot's timer and
 * the drag session. Everything visual lives in its own file — `TheatreView`,
 * `LeftRail`, `RightRail`, `Hands`, `Asking`, `Prologue`, `Overlays` — and
 * shares the `FieldProps` shape from `common.ts`.
 */

export default function GameView({ onLeave }: { onLeave: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const [past, setPast] = useState<GameState[]>([]);
  const [held, setHeld] = useState<Held | null>(null);
  const [bare, setBare] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [botSide, setBotSide] = useState<PlayerId | null>(null);
  const bot = useRef<Opponent | null>(null);

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
      bot.current?.dispose();
      bot.current = sides.bot ? makeBot() : null;
      setBotSide(bot.current ? sides.bot : null);
      setPast([]);
      setHeld(null);
      setFault(null);
      setBeats([]);
      setShows([]);
      setPrologue(true);
      // Decoding takes a few milliseconds and `playSound` does not wait for it,
      // so an un-warmed cue arrives a beat late. Warm them while the prologue
      // is still playing its ceremony.
      preloadSounds(matchSounds());
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
      const fresh = beatsBetween(state, next);
      setBeats((b) => {
        // A phase turning over waits for the phase it is ending.
        //
        // Batches are independent — each is timed from the moment its action
        // landed — so a player's last unit could still be settling onto the
        // board while the banner announcing the end of the gathering came
        // across the middle of the screen. A step or a pass is a full stop, and
        // a full stop cannot be said over the top of the sentence it ends, so a
        // batch carrying one queues up behind whatever is still playing.
        const closing = fresh.some((beat) => beat.kind === "step" || beat.kind === "done");
        const base = closing ? Math.max(at, ...b.map((live) => live.expiresAt)) : at;
        return [
          ...b,
          ...fresh.map((beat) => ({
            ...beat,
            startsAt: base + beat.at,
            expiresAt: base + beat.at + BEAT_MS[beat.kind],
          })),
        ];
      });
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

  // A game left behind should not leave a thread thinking about it.
  useEffect(() => () => bot.current?.dispose(), []);

  /**
   * The same beats, heard.
   *
   * Sound rides the theatre clock rather than the state, so a cue lands on the
   * moment its beat starts — which for a chain is not the moment the action was
   * sent. The `sounded` ref is the same guard `flown` needs and for the same
   * reason: the beat list is rebuilt on every render, so without a record of
   * what has already played, one death would fire forty times a second.
   */
  const sounded = useRef(new Set<number>());
  useEffect(() => {
    for (const beat of beats) {
      if (beat.startsAt > Date.now()) continue;
      if (sounded.current.has(beat.id)) continue;
      sounded.current.add(beat.id);
      playSound(soundFor(beat));
    }
  }, [beats]);

  // The room tone follows the battlefield, and stops when the match does.
  const locationId = state?.locations[state.locationIndex]?.cardId;
  useEffect(() => {
    playAmbience(locationId ? ambienceFor(locationId) : null);
  }, [locationId]);
  useEffect(() => stopAmbience, []);

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

  /**
   * Taking a spell back, up to the moment it becomes real.
   *
   * 8.4.1 has the caster and the target named in the same breath as the card:
   * one declaration, not three. The screen has to ask for them one at a time, so
   * a player halfway through has announced nothing yet — and the engine agrees,
   * because a cast touches nothing at all until every pick is in and
   * `applyCastEntry` runs. Right up to that moment this rewinds the whole
   * declaration: the card goes back to the hand, the turn is unspent, and the
   * chronicle never mentions it.
   *
   * It is an undo rather than an engine action on purpose. Cancelling is not
   * something the rules let you do, it is the absence of something you never
   * finished doing, and giving the engine a move for it would put "cast, take it
   * back, cast again" in front of the bot as a legal loop. So the history does
   * the work, unwinding to the last position that had no spell in the air.
   */
  function cancelCast() {
    setPast((h) => {
      // Walk back over every position that still had a spell in the air; the
      // first one that did not is the position before the cast. Cancelling
      // immediately, before a single pick, is the common case and lands on the
      // very last entry — so there is no "must have picked something" guard
      // here, only a "must have somewhere to go back to" one.
      let at = h.length;
      while (at > 0 && h[at - 1].resolution !== null) at -= 1;
      if (at === 0) return h;
      setState(h[at - 1]);
      setHeld(null);
      setBeats([]);
      setShows([]);
      return h.slice(0, at - 1);
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
      cancelCast={cancelCast}
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
  const { state, actor, held, setHeld, send, bare, botSide, bot, now, cancelCast } = props;
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
  /** The position the screen is showing, which trails the real one by a beat. */
  const shown = useMemo(() => boardAsOf(state, props.beats, now), [state, props.beats, now]);

  const asking = pendingPrompt(state);
  const pending = state.resolution?.pending ?? null;
  const [logOpen, setLogOpen] = useState(false);
  /** The tile being read. Never a rule, only what the loupe beside the board shows. */
  const [inspect, setInspect] = useState<SlotId | null>(null);
  const inspected = inspect ? shown.board[inspect] : null;
  /** The card in hand being read, and the one currently in the air. */
  const [reading, setReading] = useState<string | null>(null);
  /** The same, for a card in the enemy's fan this player has peeked at. */
  const [farReading, setFarReading] = useState<{ uid: string; cardId: string } | null>(null);
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
  /**
   * A decision panel pushed out of the way so the board can be read.
   *
   * Every question worth a panel is a question about the board — which unit to
   * tutor for depends on what is already standing — and the panel is over the
   * board. So it gets a handle rather than a compromise: tuck it, read the
   * board at full brightness, bring it back. It un-tucks itself whenever the
   * question changes, because a panel hidden for the last question is not a
   * decision about this one.
   */
  const [tucked, setTucked] = useState(false);

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

  // What, if anything, the screen should be looking at rather than the board.
  // A question answered by pointing at a tile is not one of them: there the
  // board *is* the thing being read, and dimming it would be dimming the
  // answer.
  const handPanel =
    (!!asking && asking.player === viewer && handHeld(asking, state)) ||
    pending?.kind === "handCard";
  // A pile being searched is the searcher's business alone.
  //
  // The Almanac lists a deck or a graveyard, and a deck is hidden information
  // (1.5.2). Rendering it for whoever happened to be looking at the screen
  // handed the machine's whole library to the person playing against it. The
  // panel belongs to the player being asked; everyone else is told only that a
  // search is happening, which is what they would see across a table.
  const searching = !!asking && !handHeld(asking, state) && asking.picking === "card";
  const almanacUp = searching && (asking!.player === viewer || bare);
  const enemySearching = searching && !almanacUp;
  // A question that is about neither a card nor a tile. Only the coin so far,
  // and it brings its own panel.
  // Their coin is theirs to press. The throw itself is public — it happens on
  // the table and both players watch it — but the decision to throw again is a
  // decision, and handing it to whoever is looking at the screen would let you
  // play the other side's card for them.
  const coinAsking =
    asking?.picking === "option" && asking.player === viewer ? asking : null;
  const coinShowing = shows.some((s) => s.kind === "coin");
  const curtainUp = shows.some(
    (s) => s.kind !== "coin" && (s.open || s.player === viewer || bare),
  );
  const heldUp = beats.some((b) => b.kind === "land" || b.kind === "cast" || b.kind === "veil");
  // Leszerelés belongs to whoever is doing it, and only while they still can.
  const disarming =
    state.phase === "cleanup" && !!actor && actor === viewer && !state.players[actor].tossDone;
  const panelUp = almanacUp || handPanel || !!coinAsking;
  // Their search still dims the board — something is happening and it is not
  // your turn to do anything about it — but there is nothing to read.
  const spotlitQuietly = enemySearching;
  const spotlit = panelUp || curtainUp || heldUp || coinShowing || spotlitQuietly;

  // A spell that has been played but is still being aimed. Nothing about it has
  // touched the board yet, so it can still be taken back, and until it cannot
  // it is not public either.
  const castInFlight = !!state.resolution?.pending && state.resolution.pending.player === viewer;

  useEffect(() => {
    setTucked(false);
  }, [asking?.id, pending?.kind]);

  // The machine moves on a timer rather than instantly, so its turn is something
  // you watch happen instead of a board that has already changed.
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
    // Long enough to read what it just played before it plays the next thing.
    //
    // The theatre already holds a card up for a couple of seconds; the machine
    // used to start its next turn the instant that finished, so the card left
    // the screen and was immediately replaced. The extra beat is dead air on
    // purpose — it is the pause a person takes picking their next card up, and
    // it is where the player actually reads the board.
    const pause = state.phase === "cleanup" ? 120 : Math.max(1100, quiet + 700);
    // The request goes in after the pause, not before it. Asking early would
    // overlap the thinking with the theatre and save a second — but React runs
    // this effect twice in development, and the planner is stateful: two
    // questions about one position would each take an action off a cast in
    // flight. Inside the timer, the second run's cleanup cancels the first
    // before it is ever asked.
    let live = true;
    const timer = setTimeout(() => {
      void bot.current?.choose(state, botSide!).then((action) => {
        // Eight seconds is a long time for a board to stay still. It may not
        // be the same board any more — an undo, a beat landing — so a decision
        // arriving to a torn-down effect is dropped rather than played against
        // a state that is gone.
        if (live && action) send(action);
      });
    }, pause);
    return () => {
      live = false;
      clearTimeout(timer);
    };
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
    // Only whoever is actually choosing gets the legal picks lit. Watching the
    // machine cast used to light up every tile its spell could legally reach,
    // which is both a hint it was never entitled to give and a screen full of
    // glowing tiles that the player cannot click and did not ask about.
    if (pending && pending.kind !== "handCard") {
      if (pending.player !== viewer) return set;
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
    // Out of the fan and into your fingers. The drop has no cue of its own —
    // the unit landing is already a `land` or a `veil`, and two sounds for one
    // gesture is one too many.
    playSound("ui-lift");
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
    () => beats.filter((b) => b.kind === "fall" && b.slot && !shown.board[b.slot]),
    [beats, shown.board],
  );

  /**
   * The two tiles a spell on screen used: who threw it, and what it landed on.
   *
   * A spell resolves inside one action, so without this the board shows damage
   * appearing on a tile and says nothing about where it came from — and "some
   * unit of theirs hurt some unit of mine" is not a game anybody can follow. The
   * target takes its colour from the caster's point of view, not the viewer's:
   * green when the spell helped its own side, red when it went across the line.
   */
  const marks = useMemo(() => {
    const out = new Map<SlotId, string>();
    const cast = [...beats].reverse().find((b) => b.kind === "cast" && b.slot);
    if (!cast?.slot) return out;
    // In the order the sentence goes: this card, thrown by this unit, at that
    // one. The target waits, because naming both ends at once is the thing that
    // made a spell unreadable — you cannot follow an arrow whose two ends
    // appear in the same frame.
    out.set(cast.slot, "caster");
    const since = now - cast.startsAt;
    // Where it is going, before it goes. A spell that moves its caster reads as
    // three things in sequence — this unit, that tile, then the walk — and the
    // tile has to be named while the unit is still standing where it started.
    if (since >= 320 && cast.destinationSlot && cast.destinationSlot !== cast.slot) {
      out.set(cast.destinationSlot, "step");
    }
    if (since >= 620 && cast.targetSlot && cast.targetSlot !== cast.slot) {
      const caster = shown.board[cast.slot];
      const target = shown.board[cast.targetSlot];
      // Whose tile it is, when the unit that was standing there has already
      // been killed by the very spell being shown.
      const targetOwner = target?.owner ?? (cast.targetSlot.slice(0, 2) as PlayerId);
      const friendly = (caster?.owner ?? cast.player) === targetOwner;
      out.set(cast.targetSlot, friendly ? "friend" : "foe");
    }
    return out;
  }, [beats, shown.board, now]);

  const classes = ["field"];
  if (!over) classes.push("opening");
  if (spotlit && !tucked) classes.push("spotlit");
  if (panelUp && !tucked) classes.push("spotlit-hand");

  return (
    <div
      className={classes.join(" ")}
      // Which room this is. The stylesheet keys the whole ground and the
      // frame's one accent colour off it, so a battlefield changes the light
      // in here without any component knowing it happened.
      data-bf={state.locations[state.locationIndex]?.cardId}
      // Right click takes back a spell that has not finished being declared.
      // Anywhere on the screen, because there is no one place a player would
      // think to aim at — the card is in a panel, the picks are on the board,
      // and the gesture means "no, forget it" rather than "not that tile".
      onContextMenu={
        castInFlight
          ? (e) => {
              e.preventDefault();
              cancelCast();
            }
          : undefined
      }
    >
      <span className="flight-layer" />
      {spotlit && !tucked && <Spotlight />}
      <Theatre beats={beats} viewer={viewer} bare={bare} />
      <aside className="rail-left">
        <Battlefield {...props} onLog={() => setLogOpen((v) => !v)} logOpen={logOpen} />
        <TurnCue {...props} moves={moves} viewer={viewer} />
        <span className="rail-gap" />
        <Tools {...props} onLog={() => setLogOpen((v) => !v)} logOpen={logOpen} />
      </aside>

      {/* A thin strip of pictures beside the left rail, clear of everything the
          rail has to be clickable for. */}
      <Annals state={state} viewer={viewer} bare={bare} />

      <div className="arena">
        <Board
          state={shown}
          open={open}
          onPick={pickSlot}
          bare={bare}
          viewer={viewer}
          stirring={stirring}
          fallen={fallen}
          marks={marks}
          onInspect={setInspect}
        />
      </div>

      {/* The tile you are reading, printed beside the board. A sibling of the
          board rather than a child of the tile, so nothing on the board can clip
          it and it never covers the units it is being compared against. */}
      {inspected && (
        <div className={`loupe ${inspected.owner === viewer ? "mine" : "theirs"}`}>
          <Loaded unit={inspected} state={shown} />
        </div>
      )}

      {/* The far player's piles, the ledger, then yours. The ledger sits between
          them because that is where both sets of piles can reach it. */}
      <aside className="rail-right">
        <Counters state={state} side={far} viewer={viewer} botSide={botSide} bare={bare} onTrack={setTracking} />
        <Ledger state={state} tracking={tracking} />
        <Counters state={state} side={viewer} viewer={viewer} botSide={botSide} bare={bare} onTrack={setTracking} />
      </aside>

      {!over && (
        <FarHand
          state={state}
          player={far}
          viewer={viewer}
          bare={bare}
          onRead={setFarReading}
        />
      )}
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

      {/* A card in the enemy's fan that this player has looked at, printed
          downwards from the top edge the way your own is printed upwards. */}
      {farReading && <Reading uid={farReading.uid} cardId={farReading.cardId} far />}

      {/* The tile a card has just arrived on, ringed so the panel holding the
          card up says where as well as what. */}
      {spotlit &&
        !tucked &&
        [...stirring.entries()]
          .filter(([, kind]) => kind === "land" || kind === "veil" || kind === "reveal")
          .map(([slot, kind]) => <Beacon key={slot} slot={slot} kind={kind} />)}

      {/* An ability going through a pile: the deck a tutor is searching, the
          hand Griff is helping himself to. A hand of your own is picked from
          the hand itself, so only the piles reach this panel. */}
      {almanacUp && <Almanac prompt={asking!} send={send} tucked={tucked} />}

      {/* The other side going through a pile. What it is and whose, and not one
          word about what is in it. */}
      {enemySearching && (
        <div className="searching timber">
          <b>Az ellenfeled keresgél</b>
          <em>{asking!.sourceCardId ? (cardFor(asking!.sourceCardId)?.name ?? "") : ""}</em>
        </div>
      )}

      {/* The way back out from under a panel. It stays on screen while the
          panel is tucked, which is the only thing that could bring it back. */}
      {panelUp && (
        <button className="tuck-handle tiny" onClick={() => setTucked((v) => !v)}>
          {tucked ? "Vissza a kérdéshez" : "Mutasd a csatateret"}
        </button>
      )}

      {/* What somebody has just been shown, held up long enough to read. */}
      <Curtain shows={shows} viewer={viewer} bare={bare} />

      {/* Szerencsejátékos' coin, and the question that follows a win. */}
      <Coin shows={shows} prompt={coinAsking} send={send} />

      {/* Leszerelés: a real decision, so it gets a real panel. */}
      {disarming && actor && (
        <Disarming
          kept={
            state.players[actor].unitHand.length + state.players[actor].spellHand.length
          }
          onDone={() => send({ type: "declareTossDone", player: actor })}
        />
      )}

      {props.prologue && <Prologue state={state} botSide={botSide} onDone={props.endPrologue} />}

      {logOpen && <Chronicle state={state} onClose={() => setLogOpen(false)} />}
      {over && (
        <Aftermath
          state={state}
          viewer={human ?? viewer}
          onLeave={props.onLeave}
          onQuit={props.onQuit}
        />
      )}
    </div>
  );
}
