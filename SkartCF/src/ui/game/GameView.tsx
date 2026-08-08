import { useMemo, useState } from "react";
import {
  announcedBattlefields,
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
import type { Action, GameState, PlayerId, RuleConfig, SlotId } from "../../engine";
import Board from "./Board";
import SetupPanel from "./SetupPanel";
import type { SetupOptions } from "./SetupPanel";

interface Selection {
  uid: string;
  faceDown: boolean;
  payUid: string | null;
}

const PLAYER_LABEL: Record<PlayerId, string> = { p1: "1. játékos", p2: "2. játékos" };

export default function GameView() {
  const [state, setState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<GameState[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start(options: SetupOptions) {
    try {
      const config: Partial<RuleConfig> = {
        unitDeckSize: options.unitDeckSize,
        meleeFrontBonus: options.meleeFrontBonus,
        maxHiddenPerLocation: options.maxHidden,
      };
      setState(createGame({ seed: options.seed, config, decks: { p1: options.p1, p2: options.p2 } }));
      setHistory([]);
      setSelection(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function dispatch(action: Action) {
    if (!state) return;
    try {
      const next = applyAction(state, action);
      setHistory((h) => [...h.slice(-40), state]);
      setState(next);
      setSelection(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      setState(h[h.length - 1]);
      setSelection(null);
      return h.slice(0, -1);
    });
  }

  if (!state) {
    return (
      <main className="setup-screen">
        <SetupPanel onStart={start} />
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <GameScreen
      state={state}
      selection={selection}
      setSelection={setSelection}
      dispatch={dispatch}
      undo={undo}
      canUndo={history.length > 0}
      revealAll={revealAll}
      setRevealAll={setRevealAll}
      onQuit={() => setState(null)}
      error={error}
    />
  );
}

interface ScreenProps {
  state: GameState;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  dispatch: (a: Action) => void;
  undo: () => void;
  canUndo: boolean;
  revealAll: boolean;
  setRevealAll: (v: boolean) => void;
  onQuit: () => void;
  error: string | null;
}

function GameScreen(props: ScreenProps) {
  const { state, selection, setSelection, dispatch, revealAll } = props;
  const pending = state.resolution?.pending ?? null;

  const actor: PlayerId | null =
    state.phase === "commitment"
      ? state.turn
      : state.phase === "spells"
        ? (pending?.player ?? null)
        : state.phase === "scored"
          ? state.turn
          : null;

  const actions = useMemo(
    () => (actor ? legalActions(state, actor) : []),
    [state, actor],
  );

  // Which slots the current click would be legal on.
  const highlight = useMemo(() => {
    const set = new Set<SlotId>();
    if (state.phase === "spells" && pending && pending.kind !== "handCard") {
      for (const slot of pending.options) set.add(slot);
      return set;
    }
    if (state.phase === "commitment" && selection) {
      for (const a of actions) {
        if (a.type !== "playUnit") continue;
        if (a.uid !== selection.uid) continue;
        if ((a.faceDown === true) !== selection.faceDown) continue;
        if (selection.faceDown && a.discardUid !== selection.payUid) continue;
        set.add(a.slot);
      }
    }
    return set;
  }, [state.phase, pending, selection, actions]);

  function onSlotClick(slot: SlotId) {
    if (state.phase === "spells" && pending) {
      dispatch({ type: "chooseSlot", player: pending.player, slot });
      return;
    }
    if (state.phase === "commitment" && selection && actor) {
      dispatch({
        type: "playUnit",
        player: actor,
        uid: selection.uid,
        slot,
        faceDown: selection.faceDown,
        discardUid: selection.payUid ?? undefined,
      });
    }
  }

  return (
    <main className="game">
      <LocationBar state={state} />

      <div className="game-body">
        <section className="board-column">
          {state.phase === "gameOver" ? (
            <GameOverPanel state={state} />
          ) : (
            <>
              <TotalsRow state={state} side="p2" revealAll={revealAll} />
              <Board
                state={state}
                highlight={highlight}
                onSlotClick={onSlotClick}
                revealAll={revealAll}
              />
              <TotalsRow state={state} side="p1" revealAll={revealAll} />
            </>
          )}
          <PhaseBar {...props} actor={actor} actions={actions} />
        </section>

        <aside className="side-column">
          <StackPanel state={state} revealAll={revealAll} />
          <CasterPanel state={state} />
          <LogPanel state={state} />
        </aside>
      </div>

      {actor && state.phase === "commitment" && (
        <HandPanel
          state={state}
          player={actor}
          actions={actions}
          selection={selection}
          setSelection={setSelection}
          dispatch={dispatch}
        />
      )}

      {pending && pending.kind === "handCard" && (
        <div className="hand-panel">
          <div className="panel-title">{pending.prompt}</div>
          <div className="hand">
            {(pending.handOptions ?? []).map((c) => (
              <button
                key={c.uid}
                className="card unit legal"
                onClick={() => dispatch({ type: "chooseHandCard", player: pending.player, uid: c.uid })}
              >
                <UnitCardFace cardId={c.cardId} />
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

function LocationBar({ state }: { state: GameState }) {
  const location = currentLocation(state);
  const instance = state.locations[state.locationIndex];
  const upcoming = announcedBattlefields(state);
  return (
    <div className="location-bar">
      <div className="location-main">
        <span className="chip">
          {state.locationIndex + 1}. csatatér
        </span>
        <h2>{location.name}</h2>
        <span className="chip cap">
          keret {location.cap === null ? "∞" : location.cap}
        </span>
        <span className="chip">hozta: {PLAYER_LABEL[instance.broughtBy]}</span>
        <span className="muted">{location.text}</span>
      </div>
      <div className="location-side">
        <span className="score">
          {state.scores.p1} – {state.scores.p2}
        </span>
        <details className="lineup">
          <summary>A hat csatatér</summary>
          <ul>
            {upcoming.map((l) => (
              <li key={l.id}>
                <b>{l.name}</b> · keret {l.cap === null ? "∞" : l.cap} ·{" "}
                {PLAYER_LABEL[l.broughtBy]}
                <br />
                <span className="muted">{l.text}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

/**
 * At game over the board has already been cleared for a location that never
 * came, so showing twelve empty slots is misleading. The scoreboard is the
 * thing worth looking at.
 */
function GameOverPanel({ state }: { state: GameState }) {
  const played = state.locations.filter((l) => l.winner !== null);
  return (
    <div className="panel gameover">
      <div className="panel-title">Végeredmény</div>
      <p className="score">
        {state.scores.p1} – {state.scores.p2}
      </p>
      <table>
        <tbody>
          {played.map((l, i) => {
            const card = getLocation(l.cardId);
            return (
              <tr key={i}>
                <td>{i + 1}.</td>
                <td>
                  <b>{card.name}</b>
                  <span className="muted"> · keret {card.cap === null ? "∞" : card.cap}</span>
                </td>
                <td className="muted">hozta: {PLAYER_LABEL[l.broughtBy]}</td>
                <td>
                  {l.totals ? `${l.totals.p1} – ${l.totals.p2}` : ""}
                </td>
                <td className={l.winner === "void" ? "muted" : ""}>
                  {l.winner === "void" ? "senkié" : PLAYER_LABEL[l.winner as PlayerId]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {played.some((l) => getLocation(l.cardId).tiebreaker) && (
        <p className="muted small">
          A Végtelen pusztára azért került sor, mert a hat csatatér után döntetlen volt az
          állás — a semlegesített csataterek is ide vezethetnek.
        </p>
      )}
    </div>
  );
}

function TotalsRow({
  state,
  side,
  revealAll,
}: {
  state: GameState;
  side: PlayerId;
  revealAll: boolean;
}) {
  const own = state.phase === "commitment" && !revealAll && state.turn !== side;
  const total = own ? visibleTotal(state, side) : boardTotal(state, side);
  const p = state.players[side];
  const cap = remainingCap(state, side);
  return (
    <div className={`totals ${side}`}>
      <b>{PLAYER_LABEL[side]}</b>
      <span>
        össz <b className="pw">{total}</b>
        {own && <span className="muted"> (látható)</span>}
      </span>
      <span>
        keret {p.capSpent}
        {cap === Infinity ? "" : `/${p.capSpent + cap}`}
      </span>
      <span className={p.flags.unitsClosed ? "flag closed" : "flag"}>
        egységek {p.flags.unitsClosed ? "lezárva" : "nyitva"}
      </span>
      <span className={p.flags.spellsClosed ? "flag closed" : "flag"}>
        varázslatok {p.flags.spellsClosed ? "lezárva" : "nyitva"}
      </span>
      <span className="muted">
        kéz {p.unitHand.length}/{p.spellHand.length} · pakli {p.unitDeck.length}/
        {p.spellDeck.length}
      </span>
    </div>
  );
}

function PhaseBar({
  state,
  actor,
  actions,
  dispatch,
  undo,
  canUndo,
  revealAll,
  setRevealAll,
  onQuit,
  error,
}: ScreenProps & { actor: PlayerId | null; actions: Action[] }) {
  const pending = state.resolution?.pending ?? null;
  const has = (type: Action["type"]) => actions.some((a) => a.type === type);

  return (
    <div className="phase-bar">
      <div className="phase-left">
        {state.phase === "commitment" && actor && (
          <>
            <span className="turn">{PLAYER_LABEL[actor]} köre</span>
            <button
              disabled={!has("declareUnitsDone")}
              onClick={() => dispatch({ type: "declareUnitsDone", player: actor })}
            >
              Egységek: kész
            </button>
            <button
              disabled={!has("declareSpellsDone")}
              onClick={() => dispatch({ type: "declareSpellsDone", player: actor })}
            >
              Varázslatok: kész
            </button>
            <button
              className="primary"
              disabled={!has("endTurn")}
              onClick={() => dispatch({ type: "endTurn", player: actor })}
            >
              Kör vége
            </button>
          </>
        )}

        {state.phase === "spells" && pending && (
          <span className="turn">
            {PLAYER_LABEL[pending.player]}: {pending.prompt}
          </span>
        )}

        {state.phase === "scored" && (
          <>
            <span className="turn">
              {describeResult(state)}
            </span>
            <button className="primary" onClick={() => dispatch({ type: "nextLocation" })}>
              Következő csatatér
            </button>
          </>
        )}

        {state.phase === "gameOver" && (
          <span className="turn">
            Vége — {state.winner === "draw" ? "döntetlen" : `${PLAYER_LABEL[state.winner!]} nyert`} (
            {state.scores.p1}–{state.scores.p2})
          </span>
        )}
      </div>

      <div className="phase-right">
        <label className="toggle">
          <input
            type="checkbox"
            checked={revealAll}
            onChange={(e) => setRevealAll(e.target.checked)}
          />
          Mindent mutat
        </label>
        <button onClick={undo} disabled={!canUndo}>
          Vissza
        </button>
        <button onClick={onQuit}>Új játék</button>
      </div>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function describeResult(state: GameState): string {
  const instance = state.locations[state.locationIndex];
  const name = getLocation(instance.cardId).name;
  const t = instance.totals;
  if (!t) return name;
  if (instance.winner === "void") {
    return `${name}: döntetlen ${t.p1}–${t.p2}, senkié.`;
  }
  return `${name}: ${PLAYER_LABEL[instance.winner as PlayerId]} nyeri ${t.p1}–${t.p2}.`;
}

// ---------------------------------------------------------------------------

function HandPanel({
  state,
  player,
  actions,
  selection,
  setSelection,
  dispatch,
}: {
  state: GameState;
  player: PlayerId;
  actions: Action[];
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  dispatch: (a: Action) => void;
}) {
  const p = state.players[player];
  const playable = new Set(
    actions.filter((a) => a.type === "playUnit").map((a) => (a as { uid: string }).uid),
  );
  const hideable = new Set(
    actions
      .filter((a) => a.type === "playUnit" && a.faceDown)
      .map((a) => (a as { uid: string }).uid),
  );
  const stackable = new Set(
    actions.filter((a) => a.type === "stackSpell").map((a) => (a as { uid: string }).uid),
  );

  const payOptions = selection?.faceDown
    ? p.unitHand.filter((c) => c.uid !== selection.uid)
    : [];

  return (
    <section className="hand-panel">
      <div className="panel-title">
        {PLAYER_LABEL[player]} keze — {p.unitHand.length} egység, {p.spellHand.length} varázslat
      </div>

      <div className="hand">
        {p.unitHand.map((c) => {
          const selected = selection?.uid === c.uid;
          const classes = ["card", "unit"];
          if (playable.has(c.uid)) classes.push("legal");
          if (selected) classes.push("selected");
          return (
            <button
              key={c.uid}
              className={classes.join(" ")}
              disabled={!playable.has(c.uid)}
              onClick={() =>
                setSelection(
                  selected ? null : { uid: c.uid, faceDown: false, payUid: null },
                )
              }
            >
              <UnitCardFace cardId={c.cardId} />
              {hideable.has(c.uid) && (
                <span
                  className="hide-badge"
                  title="Lapjával lefelé — ára egy egységlap a kézből"
                  onClick={(e) => {
                    e.stopPropagation();
                    const pay = p.unitHand.find((x) => x.uid !== c.uid);
                    setSelection({ uid: c.uid, faceDown: true, payUid: pay?.uid ?? null });
                  }}
                >
                  rejt
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selection?.faceDown && (
        <div className="pay-row">
          <span>Fizetség (eldobott egységlap):</span>
          {payOptions.map((c) => (
            <button
              key={c.uid}
              className={selection.payUid === c.uid ? "pay selected" : "pay"}
              onClick={() => setSelection({ ...selection, payUid: c.uid })}
            >
              {getUnit(c.cardId).name}
            </button>
          ))}
          <button className="pay" onClick={() => setSelection({ ...selection, faceDown: false })}>
            Mégse rejtem
          </button>
        </div>
      )}

      <div className="hand spells">
        {p.spellHand.map((c) => {
          const spell = getSpell(c.cardId);
          const classes = ["card", "spell"];
          if (stackable.has(c.uid)) classes.push("legal");
          return (
            <button
              key={c.uid}
              className={classes.join(" ")}
              disabled={!stackable.has(c.uid)}
              onClick={() => dispatch({ type: "stackSpell", player, uid: c.uid })}
              title={spell.text}
            >
              <span className="card-name">{spell.name}</span>
              <span className="card-line">
                <span className="school">{spell.school}</span>
                <b className="cost">{spell.cost}</b>
              </span>
              <span className="card-text">{spell.text}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function UnitCardFace({ cardId }: { cardId: string }) {
  const card = getUnit(cardId);
  const spellpower = Object.entries(card.spellpower ?? {}).filter(([, v]) => v > 0);
  return (
    <>
      <span className="card-name">{card.name}</span>
      <span className="card-line">
        <b className="pw">{card.power}</b>
        <b className="cost">{card.cost}</b>
      </span>
      <span className="card-keywords">{card.keywords.join(" · ")}</span>
      {spellpower.length > 0 && (
        <span className="card-sp">
          {spellpower.map(([school, value]) => (
            <span key={school}>
              {school} {value}
            </span>
          ))}
        </span>
      )}
      {card.text && <span className="card-text">{card.text}</span>}
    </>
  );
}

function StackPanel({ state, revealAll }: { state: GameState; revealAll: boolean }) {
  const revealed = state.phase !== "commitment" || revealAll;
  return (
    <div className="panel">
      <div className="panel-title">Varázslatpakli ({state.stack.length})</div>
      <ol className="stack">
        {state.stack.map((entry, i) => {
          const resolvedIndex = state.resolution?.index ?? -1;
          const done = state.phase !== "commitment" && i < resolvedIndex;
          return (
            <li key={entry.uid} className={`${entry.owner} ${done ? "resolved" : ""}`}>
              <span className="owner">{entry.owner === "p1" ? "J1" : "J2"}</span>
              {revealed ? getSpell(entry.cardId).name : "rejtett"}
              {revealed && <span className="cost">{getSpell(entry.cardId).cost}</span>}
            </li>
          );
        })}
        {state.stack.length === 0 && <li className="muted">üres</li>}
      </ol>
      {state.phase === "commitment" && !revealAll && (
        <p className="muted small">
          A pakli magassága és tulajdonosi sorrendje nyilvános. A tartalma nem.
        </p>
      )}
    </div>
  );
}

function CasterPanel({ state }: { state: GameState }) {
  return (
    <div className="panel">
      <div className="panel-title">Varázserő a táblán</div>
      {(["p1", "p2"] as PlayerId[]).map((player) => {
        const casters = castersOf(state, player);
        return (
          <div key={player} className="caster-side">
            <b>{PLAYER_LABEL[player]}</b>
            {casters.length === 0 && <span className="muted"> — nincs</span>}
            <ul>
              {casters.map(({ unit, pools }) => (
                <li key={unit.uid}>
                  {getUnit(unit.cardId).name} <span className="muted">{unit.slot.slice(3)}</span>{" "}
                  {Object.entries(pools).map(([school, left]) => (
                    <span className="pool" key={school}>
                      {school} {left}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function LogPanel({ state }: { state: GameState }) {
  const entries = state.log.filter((l) => l.location === state.locationIndex).slice(-40);
  return (
    <div className="panel log">
      <div className="panel-title">Napló</div>
      <ul>
        {entries.map((entry, i) => (
          <li key={i} className={entry.player ?? ""}>
            {entry.player && <span className="owner">{entry.player === "p1" ? "J1" : "J2"}</span>}
            {entry.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
