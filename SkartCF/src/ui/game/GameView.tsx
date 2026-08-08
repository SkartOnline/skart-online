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
  legalActions,
  remainingCap,
  visibleTotal,
} from "../../engine";
import type { Action, GameState, PlayerId, SlotId } from "../../engine";
import Board from "./Board";
import NewGame from "./NewGame";
import type { Sides } from "./NewGame";

interface Held {
  uid: string;
  veiled: boolean;
  tollUid: string | null;
}

const SIDE: Record<PlayerId, string> = { p1: "Első", p2: "Második" };

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
  const actor: PlayerId | null =
    state.phase === "commitment"
      ? state.turn
      : state.phase === "spells"
        ? (pending?.player ?? null)
        : state.phase === "scored"
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

  const moves = useMemo(() => (actor ? legalActions(state, actor) : []), [state, actor]);

  const open = useMemo(() => {
    const set = new Set<SlotId>();
    if (state.phase === "spells" && pending && pending.kind !== "handCard") {
      for (const slot of pending.options) set.add(slot);
      return set;
    }
    if (state.phase === "commitment" && held) {
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
    if (state.phase === "spells" && pending) {
      send({ type: "chooseSlot", player: pending.player, slot });
      return;
    }
    if (state.phase === "commitment" && held && actor) {
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

  return (
    <div className="field">
      <Banner {...props} />

      <div className="field-body">
        <div className="arena">
          {state.phase === "gameOver" ? (
            <Aftermath state={state} />
          ) : (
            <>
              <Ledger state={state} side="p2" bare={bare} />
              <Board state={state} open={open} onPick={pickSlot} bare={bare} />
              <Ledger state={state} side="p1" bare={bare} />
            </>
          )}
        </div>

        <div className="rail">
          <Rakas state={state} bare={bare} />
          <Wells state={state} />
          <Chronicle state={state} />
        </div>
      </div>

      <Tray {...props} moves={moves} />
    </div>
  );
}

function Banner({ state, onLeave, onQuit }: FieldProps) {
  const location = currentLocation(state);
  const here = state.locations[state.locationIndex];
  return (
    <div className="banner">
      <button className="quiet" onClick={onLeave} title="Vissza a főmenübe">
        ‹ Menü
      </button>
      <span className="label num">{state.locationIndex + 1}/6</span>
      <h2>{location.name}</h2>
      <span className="cap num">
        keret {location.cap === null ? "∞" : location.cap}
      </span>
      <span className="label">hozta: {SIDE[here.broughtBy]}</span>
      <span className="flavour">{location.text}</span>
      <span className="tally">
        <span className="p1">{state.scores.p1}</span>
        <span className="faint">–</span>
        <span className="p2">{state.scores.p2}</span>
      </span>
      <button className="quiet" onClick={onQuit}>
        Új parti
      </button>
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
  // Mid-commitment the idle side only shows what is actually visible: a
  // face-down unit contributes nothing to what the opponent can read.
  const veiledFromUs = state.phase === "commitment" && !bare && state.turn !== side;
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
        kéz {p.unitHand.length}·{p.spellHand.length} — pakli {p.unitDeck.length}·
        {p.spellDeck.length}
      </span>
    </div>
  );
}

/** The shared pile both players commit into. Not the deck they brought. */
function Rakas({ state, bare }: { state: GameState; bare: boolean }) {
  const shown = state.phase !== "commitment" || bare;
  const at = state.resolution?.index ?? -1;
  return (
    <div className="slab timber">
      <h3>Rakás — {state.stack.length}</h3>
      <div className="scrolls">
        <ol className="pile">
          {state.stack.map((entry, i) => {
            const spent = state.phase !== "commitment" && i < at;
            const now = state.phase === "spells" && i === at;
            return (
              <li key={entry.uid} className={spent ? "spent" : now ? "now" : ""}>
                <span className={`sigil ${entry.owner}`}>{entry.owner === "p1" ? "I" : "II"}</span>
                {shown ? getSpell(entry.cardId).name : <span className="faint">lefordítva</span>}
                {shown && <span className="coin">{getSpell(entry.cardId).cost}</span>}
              </li>
            );
          })}
          {state.stack.length === 0 && <li className="faint">üres</li>}
        </ol>
      </div>
    </div>
  );
}

function Wells({ state }: { state: GameState }) {
  return (
    <div className="slab timber">
      <h3>Varázserő a táblán</h3>
      <div className="scrolls">
        {(["p1", "p2"] as PlayerId[]).map((player) => {
          const casters = castersOf(state, player);
          return (
            <ul className="wells" key={player}>
              {casters.map(({ unit, pools }) => (
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
          );
        })}
        {castersOf(state, "p1").length + castersOf(state, "p2").length === 0 && (
          <p className="faint">Senki nem tud varázsolni.</p>
        )}
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
        <span className="faint">–</span>
        <span className="p2">{state.scores.p2}</span>
      </p>
      <ul className="chronicle">
        {played.map((l, i) => {
          const card = getLocation(l.cardId);
          return (
            <li key={i}>
              <span className="faint num">{i + 1}.</span>
              <b>{card.name}</b>
              {l.totals && (
                <span className="num dim">
                  {l.totals.p1}–{l.totals.p2}
                </span>
              )}
              <span className={l.winner === "void" ? "faint" : ""}>
                {l.winner === "void" ? "senkié" : SIDE[l.winner as PlayerId]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Tray(props: FieldProps & { moves: Action[] }) {
  const { state, actor, held, setHeld, send, moves, bare, setBare, stepBack, canStepBack, fault } =
    props;
  const pending = state.resolution?.pending ?? null;
  const can = (type: Action["type"]) => moves.some((m) => m.type === type);

  return (
    <div className="tray">
      <div className="tray-head">
        {state.phase === "commitment" && actor && (
          <>
            <span className={`turn ${actor}`}>{SIDE[actor]} lép</span>
            <button
              disabled={!can("declareUnitsDone")}
              onClick={() => send({ type: "declareUnitsDone", player: actor })}
            >
              Egységek: kész
            </button>
            <button
              disabled={!can("declareSpellsDone")}
              onClick={() => send({ type: "declareSpellsDone", player: actor })}
            >
              Varázslatok: kész
            </button>
            <button
              className="ember"
              disabled={!can("endTurn")}
              onClick={() => send({ type: "endTurn", player: actor })}
            >
              Kör vége
            </button>
          </>
        )}

        {state.phase === "spells" && pending && (
          <span className={`turn ${pending.player}`}>
            {SIDE[pending.player]}: {pending.prompt}
          </span>
        )}

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

      {actor && state.phase === "commitment" && (
        <Hand state={state} player={actor} moves={moves} held={held} setHeld={setHeld} send={send} />
      )}

      {pending?.kind === "handCard" && (
        <div className="fan">
          {(pending.handOptions ?? []).map((c) => (
            <button
              key={c.uid}
              className="slip playable"
              onClick={() => send({ type: "chooseHandCard", player: pending.player, uid: c.uid })}
            >
              <UnitFace cardId={c.cardId} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function verdict(state: GameState): string {
  const here = state.locations[state.locationIndex];
  const name = getLocation(here.cardId).name;
  const t = here.totals;
  if (!t) return name;
  if (here.winner === "void") return `${name}: ${t.p1}–${t.p2}, senkié.`;
  return `${name}: ${SIDE[here.winner as PlayerId]} viszi, ${t.p1}–${t.p2}.`;
}

function Hand({
  state,
  player,
  moves,
  held,
  setHeld,
  send,
}: {
  state: GameState;
  player: PlayerId;
  moves: Action[];
  held: Held | null;
  setHeld: (h: Held | null) => void;
  send: (a: Action) => void;
}) {
  const p = state.players[player];
  const playable = new Set(
    moves.filter((m) => m.type === "playUnit").map((m) => (m as { uid: string }).uid),
  );
  const veilable = new Set(
    moves
      .filter((m) => m.type === "playUnit" && m.faceDown)
      .map((m) => (m as { uid: string }).uid),
  );
  const stackable = new Set(
    moves.filter((m) => m.type === "stackSpell").map((m) => (m as { uid: string }).uid),
  );

  return (
    <>
      <div className="fan">
        {p.unitHand.map((c) => {
          const picked = held?.uid === c.uid;
          const cls = ["slip"];
          if (playable.has(c.uid)) cls.push("playable");
          if (picked) cls.push("picked");
          return (
            <button
              key={c.uid}
              className={cls.join(" ")}
              disabled={!playable.has(c.uid)}
              onClick={() =>
                setHeld(picked ? null : { uid: c.uid, veiled: false, tollUid: null })
              }
            >
              <UnitFace cardId={c.cardId} />
              {veilable.has(c.uid) && (
                <span
                  className="veil-tag"
                  title="Lefordítva — ára egy egységlap a kezedből"
                  onClick={(e) => {
                    e.stopPropagation();
                    const toll = p.unitHand.find((x) => x.uid !== c.uid);
                    setHeld({ uid: c.uid, veiled: true, tollUid: toll?.uid ?? null });
                  }}
                >
                  fordít
                </span>
              )}
            </button>
          );
        })}

        {p.spellHand.map((c) => {
          const spell = getSpell(c.cardId);
          const cls = ["slip", "rune"];
          if (stackable.has(c.uid)) cls.push("playable");
          return (
            <button
              key={c.uid}
              className={cls.join(" ")}
              disabled={!stackable.has(c.uid)}
              onClick={() => send({ type: "stackSpell", player, uid: c.uid })}
              title="A rakásra teszed, és ezzel a kör át is száll."
            >
              <span className="title">{spell.name}</span>
              <span className="row">
                <span className="might-n">{spell.cost}</span>
                <span className="traits">{spell.school}</span>
              </span>
              <span className="said">{spell.text}</span>
            </button>
          );
        })}
      </div>

      {held?.veiled && (
        <div className="toll">
          <span className="label">Ára — eldobott egységlap:</span>
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
    </>
  );
}

function UnitFace({ cardId }: { cardId: string }) {
  const card = getUnit(cardId);
  const wells = Object.entries(card.spellpower ?? {}).filter(([, v]) => v > 0);
  return (
    <>
      <span className="title">{card.name}</span>
      <span className="row">
        <span className="might-n">{card.power}</span>
        <span className="coin-n">{card.cost}</span>
        <span className="traits">{card.keywords.join(" · ")}</span>
      </span>
      {wells.length > 0 && (
        <span className="arcana">
          {wells.map(([school, value]) => (
            <span key={school}>
              {school} {value}
            </span>
          ))}
        </span>
      )}
      {card.text && <span className="said">{card.text}</span>}
    </>
  );
}
