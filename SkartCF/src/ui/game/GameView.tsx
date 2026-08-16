import { useMemo, useState } from "react";
import {
  applyAction,
  boardTotal,
  castersOf,
  createGame,
  currentLocation,
  getLocation,
  getSpell,
  getUnit,
  isMasterSpell,
  legalActions,
  remainingCap,
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
import Board from "./Board";
import NewGame from "./NewGame";
import type { Sides } from "./NewGame";

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

  function begin(sides: Sides) {
    try {
      setState(createGame({ seed: sides.seed, decks: { p1: sides.p1, p2: sides.p2 } }));
      setPast([]);
      setHeld(null);
      setFault(null);
    } catch (e) {
      setFault(String(e));
    }
  }

  function send(action: Action) {
    if (!state) return;
    try {
      const next = applyAction(state, action);
      setPast((h) => [...h.slice(-40), state]);
      setState(next);
      setHeld(null);
      setFault(null);
    } catch (e) {
      setFault(String(e));
    }
  }

  function stepBack() {
    setPast((h) => {
      if (h.length === 0) return h;
      setState(h[h.length - 1]);
      setHeld(null);
      return h.slice(0, -1);
    });
  }

  if (!state) return <NewGame onStart={begin} onLeave={onLeave} />;

  const pending = state.resolution?.pending ?? null;
  const actor: PlayerId | null = pending
    ? pending.player
    : state.phase === "units" || state.phase === "battle" || state.phase === "scored"
      ? state.turn
      : null;

  return (
    <Field
      state={state}
      actor={actor}
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

interface FieldProps {
  state: GameState;
  actor: PlayerId | null;
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

function Field(props: FieldProps) {
  const { state, actor, held, send, bare } = props;
  const pending = state.resolution?.pending ?? null;

  // The table turns: whoever is acting sits at the bottom of the screen, with
  // their hand in front of them and the enemy across the line.
  const viewer: PlayerId = actor ?? state.turn;
  const far = other(viewer);

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

  function pickSlot(slot: SlotId) {
    if (pending) {
      send({ type: "chooseSlot", player: pending.player, slot });
      return;
    }
    if (state.phase === "units" && held && actor) {
      send({
        type: "playUnit",
        player: actor,
        uid: held.uid,
        slot,
        faceDown: held.veiled,
        discardUid: held.tollUid ?? undefined,
      });
    }
  }

  const over = state.phase === "gameOver";

  return (
    <div className="field">
      <Banner {...props} />
      <StatusBar {...props} moves={moves} viewer={viewer} />

      <div className="field-body">
        <div className="arena">
          {over ? (
            <Aftermath state={state} />
          ) : (
            <>
              <Ledger state={state} side={far} bare={bare} />
              <Board state={state} open={open} onPick={pickSlot} bare={bare} viewer={viewer} />
              <Ledger state={state} side={viewer} bare={bare} />
            </>
          )}
        </div>

        <div className="rail">
          <CastLog state={state} viewer={viewer} />
          <Wells state={state} />
          <Chronicle state={state} />
        </div>
      </div>

      {!over && <FarHand state={state} player={far} bare={bare} />}
      {!over && <NearHand {...props} moves={moves} viewer={viewer} />}
    </div>
  );
}

function Banner({ state, onLeave, onQuit }: FieldProps) {
  const location = currentLocation(state);
  const here = state.locations[state.locationIndex];
  return (
    <div className="banner">
      <button className="quiet" onClick={onLeave}>
        Menü
      </button>
      <span className="label num">{state.locationIndex + 1}/6</span>
      <h2>{location.name}</h2>
      <span className="cap num">keret {location.cap === null ? "∞" : location.cap}</span>
      <span className="label">hozta: {SIDE[here.broughtBy]}</span>
      <span className="tally">
        <span className="p1">{state.scores.p1}</span>
        <span className="faint">:</span>
        <span className="p2">{state.scores.p2}</span>
      </span>
      <button className="quiet" onClick={onQuit}>
        Új parti
      </button>
    </div>
  );
}

/**
 * Whose turn it is, what they may still announce, and the one prompt a spell in
 * mid-resolution puts up. It lives here rather than by the hand so the fan has
 * the whole bottom of the screen to itself.
 */
function StatusBar(props: FieldProps & { moves: Action[]; viewer: PlayerId }) {
  const { state, actor, send, moves, bare, setBare, stepBack, canStepBack, fault, viewer } = props;
  const pending = state.resolution?.pending ?? null;
  const can = (type: Action["type"]) => moves.some((m) => m.type === type);
  const channel = state.channel[viewer];
  const enemyChannel = state.channel[other(viewer)];

  return (
    <div className="statusbar">
      {pending ? (
        <span className={`turn ${pending.player}`}>
          {SIDE[pending.player]}: {pending.prompt}
        </span>
      ) : (
        actor &&
        (state.phase === "units" || state.phase === "battle") && (
          <>
            <span className={`turn ${actor}`}>
              {SIDE[actor]} lép, {state.phase === "units" ? "egységek" : "csata"}
            </span>
            {state.phase === "units" ? (
              <button
                disabled={!can("declareUnitsDone")}
                onClick={() => send({ type: "declareUnitsDone", player: actor })}
              >
                Egységek: kész
              </button>
            ) : (
              <button
                disabled={!can("declareSpellsDone")}
                onClick={() => send({ type: "declareSpellsDone", player: actor })}
              >
                Varázslatok: kész
              </button>
            )}
          </>
        )
      )}

      {channel && (
        <span className="channel mine">Mesteri: {getSpell(channel.cardId).name}</span>
      )}
      {enemyChannel && <span className="channel theirs">Mesteri varázslat készül</span>}

      {state.phase === "scored" && (
        <>
          <span className="turn">{verdict(state)}</span>
          <button className="ember" onClick={() => send({ type: "nextLocation" })}>
            Tovább
          </button>
        </>
      )}

      {state.phase === "gameOver" && (
        <span className="turn">
          {state.winner === "draw"
            ? "Döntetlen."
            : `${SIDE[state.winner as PlayerId]} játékos nyert.`}
        </span>
      )}

      <span className="right">
        {fault && <span className="bad">{fault}</span>}
        <label className="swap">
          <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
          Mindent mutat
        </label>
        <button className="quiet" onClick={stepBack} disabled={!canStepBack}>
          Vissza
        </button>
      </span>
    </div>
  );
}

function Ledger({
  state,
  side,
  bare,
}: {
  state: GameState;
  side: PlayerId;
  bare: boolean;
}) {
  // While units are still going down, the idle side only shows what is actually
  // visible: a face-down unit contributes nothing to what the opponent can read.
  const veiledFromUs = state.phase === "units" && !bare && state.turn !== side;
  const sum = veiledFromUs ? visibleTotal(state, side) : boardTotal(state, side);
  const p = state.players[side];
  const left = remainingCap(state, side);
  return (
    <div className={`ledger ${side}`}>
      <span className="who">{SIDE[side]}</span>
      <span>
        <span className="sum">{sum}</span>
        {veiledFromUs && <span className="faint"> látható</span>}
      </span>
      <span className="num dim">
        keret {p.capSpent}
        {left === Infinity ? "" : `/${p.capSpent + left}`}
      </span>
      <span className={p.flags.unitsClosed ? "shut" : "open"}>egységek</span>
      <span className={p.flags.spellsClosed ? "shut" : "open"}>varázslatok</span>
      <span className="faint num">
        kéz {p.unitHand.length}·{p.spellHand.length} · pakli {p.unitDeck.length}·
        {p.spellDeck.length}
      </span>
    </div>
  );
}

// --------------------------------------------------------------------- rail

function CastLog({ state, viewer }: { state: GameState; viewer: PlayerId }) {
  const at = state.resolution?.index ?? -1;
  return (
    <div className="slab timber">
      <h3>Elsült varázslatok · {state.spellsCast.length}</h3>
      <div className="scrolls">
        <ol className="pile">
          {state.spellsCast.map((entry, i) => {
            const spell = getSpell(entry.cardId);
            const now = i === at && !!state.resolution;
            return (
              <li key={entry.uid} className={now ? "now" : "spent"}>
                <span className={`sigil ${entry.owner}`}>{entry.owner === "p1" ? "I" : "II"}</span>
                {spell.name}
                <span className="coin">{spell.cost}</span>
              </li>
            );
          })}
          {(["p1", "p2"] as PlayerId[]).map((id) => {
            const channel = state.channel[id];
            if (!channel) return null;
            return (
              <li key={`ch-${id}`} className="now">
                <span className={`sigil ${id}`}>{id === "p1" ? "I" : "II"}</span>
                {id === viewer ? getSpell(channel.cardId).name : "Mesteri varázslat"}
                <span className="coin">készül</span>
              </li>
            );
          })}
          {state.spellsCast.length === 0 && <li className="faint">még egy sem</li>}
        </ol>
      </div>
    </div>
  );
}

function Wells({ state }: { state: GameState }) {
  const empty = castersOf(state, "p1").length + castersOf(state, "p2").length === 0;
  return (
    <div className="slab timber">
      <h3>Varázserő a táblán</h3>
      <div className="scrolls">
        {(["p1", "p2"] as PlayerId[]).map((player) => (
          <ul className="wells" key={player}>
            {castersOf(state, player).map(({ unit, pools }) => (
              <li key={unit.uid}>
                <span className={`sigil ${player}`}>{player === "p1" ? "I" : "II"}</span>
                {getUnit(unit.cardId).name}
                <span className="faint">{unit.slot.slice(3)}</span>
                {Object.entries(pools).map(([school, left]) => (
                  <span className="well" key={school}>
                    {school} {left}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ))}
        {empty && <p className="faint">Senki nem tud varázsolni.</p>}
      </div>
    </div>
  );
}

function Chronicle({ state }: { state: GameState }) {
  const lines = state.log.filter((l) => l.location === state.locationIndex).slice(-60);
  return (
    <div className="slab timber">
      <h3>Krónika</h3>
      <div className="scrolls">
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
    </div>
  );
}

function Aftermath({ state }: { state: GameState }) {
  const played = state.locations.filter((l) => l.winner !== null);
  return (
    <div className="slab timber scrolls">
      <h3>Vége</h3>
      <p className="tally" style={{ fontSize: 34, marginLeft: 0 }}>
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
    </div>
  );
}

function verdict(state: GameState): string {
  const here = state.locations[state.locationIndex];
  const name = getLocation(here.cardId).name;
  const t = here.totals;
  if (!t) return name;
  if (here.winner === "void") return `${name}: ${t.p1}:${t.p2}, senkié.`;
  return `${name}: ${SIDE[here.winner as PlayerId]} viszi, ${t.p1}:${t.p2}.`;
}

// -------------------------------------------------------------------- hands

/** Where card `i` of `n` sits on the arc. */
function arc(i: number, n: number, flip = false): React.CSSProperties {
  const mid = (n - 1) / 2;
  const offset = i - mid;
  const angle = offset * 4.5 * (flip ? -1 : 1);
  const drop = offset * offset * 2.6 * (flip ? -1 : 1);
  return { transform: `rotate(${angle}deg) translateY(${drop}px)`, zIndex: 10 + i };
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
            <div className="hand-slot" key={c.uid} style={arc(i, cards.length, true)}>
              {bare ? (
                <CardFace
                  card={kind === "unit" ? getUnit(c.cardId) : getSpell(c.cardId)}
                  className={kind === "spell" ? "spell" : ""}
                />
              ) : (
                <span className={`cardback ${kind}`} />
              )}
            </div>
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
function NearHand(props: FieldProps & { moves: Action[]; viewer: PlayerId }) {
  const { state, actor, held, setHeld, send, moves, viewer } = props;
  const pending = state.resolution?.pending ?? null;
  const p = state.players[viewer];
  const mine = actor === viewer;
  const unitsPhase = state.phase === "units";
  const channel = state.channel[viewer];

  const playable = new Set(
    moves.filter((m) => m.type === "playUnit").map((m) => (m as { uid: string }).uid),
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

  // A spell asking for a card out of hand takes over the tray entirely.
  if (pending?.kind === "handCard") {
    const options = pending.handOptions ?? [];
    return (
      <div className="hand-rail near">
        <div className="hand-group">
          {options.map((c, i) => (
            <Slot
              key={c.uid}
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

      <div className="hand-rail near">
        <div className={`hand-group${unitsPhase && mine ? "" : " muted"}`}>
          {p.unitHand.map((c, i) => {
            const card: UnitCard = getUnit(c.cardId);
            const live = mine && unitsPhase && playable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                style={arc(i, p.unitHand.length)}
                playable={live}
                picked={held?.uid === c.uid}
                onClick={
                  live
                    ? () =>
                        setHeld(
                          held?.uid === c.uid ? null : { uid: c.uid, veiled: false, tollUid: null },
                        )
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

        <div className={`hand-group${!unitsPhase && mine ? "" : " muted"}`}>
          {p.spellHand.map((c, i) => {
            const card: SpellCard = getSpell(c.cardId);
            const toss = mine && tossable.has(c.uid);
            const cast = mine && !channel && castable.has(c.uid);
            return (
              <Slot
                key={c.uid}
                style={arc(i, p.spellHand.length)}
                playable={toss || cast}
                dead={mine && !unitsPhase && !toss && !cast}
                onClick={
                  toss
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

function Slot({
  style,
  playable,
  picked,
  dead,
  onClick,
  children,
}: {
  style: React.CSSProperties;
  playable?: boolean;
  picked?: boolean;
  dead?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const classes = ["hand-slot"];
  if (playable) classes.push("playable");
  if (picked) classes.push("picked");
  if (dead) classes.push("dead");
  return (
    <div
      className={classes.join(" ")}
      style={style}
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
      {children}
    </div>
  );
}
