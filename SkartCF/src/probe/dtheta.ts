/** Does sketching their board make ΔΘ stop being zero? */
import { pendingPrompt } from "../engine/prompts";
import { applyAction, legalActions, remainingCap } from "../engine/reducer";
import { createGame } from "../engine/setup";
import { slotsOf } from "../engine/grid";
import type { Action, GameState, PlayerId } from "../engine/types";
import { chooseBaselineAction, DEFAULT_BASELINE } from "../sim/baseline";
import { bestBoard, DEFAULT_BOARD, scoreBoard } from "../bot/board";
import { compositions, enables } from "../bot/compose";
import { fillExpected } from "../bot/expect";
import { DEFAULT_PLANNER, Planner } from "../bot/planner";
import { FAST_THETA } from "../bot/theta";
import { boardTotal } from "../engine/totaling";

function actorOf(s: GameState): PlayerId | null {
  const a = pendingPrompt(s); if (a) return a.player;
  if (s.resolution?.pending) return s.resolution.pending.player;
  if (s.phase === "units" || s.phase === "battle") return s.turn;
  if (s.phase === "scored" || s.phase === "cleanup") return legalActions(s, "p1").length > 0 ? "p1" : "p2";
  return null;
}
const T = FAST_THETA;
const me = new Planner({ ...DEFAULT_PLANNER, theta: T, board: { theta: T } });
const bl = { params: DEFAULT_BASELINE };
let state = createGame({ seed: "7", decks: { p1: "magus", p2: "felindori" } });
let n = 0, shown = 0;
while (state.phase !== "gameOver" && n < 200 && shown < 2) {
  const p = actorOf(state); if (!p) break;
  if (p === "p1" && state.phase === "units" && !state.resolution && !pendingPrompt(state)) {
    const cap = remainingCap(state, "p1");
    const free = slotsOf("p1").filter((s) => !state.board[s]);
    const sets = compositions(state, "p1", Number.isFinite(cap) ? cap : 999, Math.min(free.length, 6))
      .filter((c) => c.uids.length > 0);
    for (const c of sets) c.promise = c.cards.reduce((s,k)=>s+k.power,0) + 0.5*enables(state,"p1",c,free);
    sets.sort((a,b)=>b.promise-a.promise);
    const sketch = fillExpected(state, "p1");
    console.log(`\ncap ${cap}. their real board: ${boardTotal(state,"p2")}; sketched: ${boardTotal(sketch,"p2")}`);
    const hand = state.players.p1.unitHand;
    const off = scoreBoard(state, "p1", T, 0.8, 0, false);
    const on = scoreBoard(state, "p1", T, 0.8, 0, true);
    console.log(`  standing pat: Θ off ${((off.score-off.margin)/0.8).toFixed(1)}  Θ on ${((on.score-on.margin)/0.8).toFixed(1)}`);
    for (const c of sets.slice(0, 5)) {
      const only = structuredClone(state);
      only.players.p1.unitHand = hand.filter((x) => c.uids.includes(x.uid));
      const a = bestBoard(only, "p1", { ...DEFAULT_BOARD, theta: T, expectOpponent: false });
      const b = bestBoard(only, "p1", { ...DEFAULT_BOARD, theta: T, expectOpponent: true });
      const ta = (a.score - a.margin)/0.8, tb = (b.score - b.margin)/0.8;
      console.log(`  ${c.cards.map(k=>k.name).join(" + ").slice(0,42).padEnd(42)} ΔΘ off ${(ta-(off.score-off.margin)/0.8).toFixed(1)}  ΔΘ on ${(tb-(on.score-on.margin)/0.8).toFixed(1)}`);
    }
    shown++;
  }
  const a: Action | null = p === "p1" ? me.choose(state, p) : chooseBaselineAction(state, p, bl);
  if (!a) break;
  state = applyAction(state, a); n++;
}
