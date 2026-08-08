import { getLocation, getSpell, getUnit } from "./cards";
import { makeUnitInstance } from "./effects";
import { ALL_SLOTS, ownerOfSlot, slotsOf } from "./grid";
import { cardOf, currentLocation, unitsOf } from "./power";
import {
  advanceResolution,
  beginResolution,
  chooseHandCard,
  chooseSlot,
  fireBelepo,
  log,
  resolutionFinished,
} from "./resolve";
import { locationWinner, scoreboard, totals } from "./totaling";
import type { Action, GameState, PlayerId, SlotId } from "./types";
import { PLAYERS } from "./types";

/**
 * `applyAction(state, action) => state`. The whole rules engine funnels through
 * here. React only renders state and dispatches actions; the simulator calls
 * the same function with choices from a policy. Neither one gets its own copy
 * of a rule.
 */

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function other(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

export function remainingCap(state: GameState, player: PlayerId): number {
  const cap = currentLocation(state).cap;
  if (cap === null) return Infinity;
  return cap - state.players[player].capSpent;
}

export function emptySlotsOf(state: GameState, player: PlayerId): SlotId[] {
  return slotsOf(player).filter((s) => !state.board[s]);
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

/**
 * Returns an empty array when both of a player's flags are closed, and the turn
 * loop skips them rather than ending the phase. The phase ends only when all
 * four flags are true.
 */
export function legalActions(state: GameState, player: PlayerId): Action[] {
  const out: Action[] = [];

  if (state.phase === "spells") {
    const pending = state.resolution?.pending;
    if (!pending || pending.player !== player) return out;
    if (pending.kind === "handCard") {
      for (const c of pending.handOptions ?? []) {
        out.push({ type: "chooseHandCard", player, uid: c.uid });
      }
    } else {
      for (const slot of pending.options) out.push({ type: "chooseSlot", player, slot });
    }
    return out;
  }

  if (state.phase === "scored") {
    if (player === state.turn) out.push({ type: "nextLocation" });
    return out;
  }

  if (state.phase !== "commitment" || state.turn !== player) return out;

  const p = state.players[player];
  const free = emptySlotsOf(state, player);
  const cap = remainingCap(state, player);

  if (!p.flags.unitsClosed && !state.turnActions.unitPlayed) {
    for (const card of p.unitHand) {
      if (getUnit(card.cardId).cost > cap) continue;
      for (const slot of free) {
        out.push({ type: "playUnit", player, uid: card.uid, slot });
        if (canHide(state, player, card.uid)) {
          const payment = p.unitHand.find((c) => c.uid !== card.uid);
          if (payment) {
            out.push({
              type: "playUnit",
              player,
              uid: card.uid,
              slot,
              faceDown: true,
              discardUid: payment.uid,
            });
          }
        }
      }
    }
  }

  if (!p.flags.spellsClosed && !state.turnActions.spellPlayed) {
    for (const card of p.spellHand) {
      out.push({ type: "stackSpell", player, uid: card.uid });
    }
  }

  if (!p.flags.unitsClosed) out.push({ type: "declareUnitsDone", player });
  if (!p.flags.spellsClosed) out.push({ type: "declareSpellsDone", player });
  out.push({ type: "endTurn", player });

  return out;
}

function canHide(state: GameState, player: PlayerId, committedUid: string): boolean {
  const p = state.players[player];
  if (p.hiddenThisLocation >= state.config.maxHiddenPerLocation) return false;
  const spare = p.unitHand.some((c) => c.uid !== committedUid);
  return spare || state.config.allowHideWithoutSpare;
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): GameState {
  const next = clone(state);
  switch (action.type) {
    case "playUnit":
      doPlayUnit(next, action);
      break;
    case "stackSpell":
      doStackSpell(next, action);
      break;
    case "declareUnitsDone":
      if (next.phase === "commitment" && next.turn === action.player) {
        next.players[action.player].flags.unitsClosed = true;
        log(next, "Egységek: kész.", action.player);
      }
      break;
    case "declareSpellsDone":
      if (next.phase === "commitment" && next.turn === action.player) {
        next.players[action.player].flags.spellsClosed = true;
        log(next, "Varázslatok: kész.", action.player);
      }
      break;
    case "endTurn":
      if (next.phase === "commitment" && next.turn === action.player) passTurn(next);
      break;
    case "chooseSlot":
      chooseSlot(next, action.slot);
      break;
    case "chooseHandCard":
      chooseHandCard(next, action.uid);
      break;
    case "nextLocation":
      startNextLocation(next);
      break;
  }
  settle(next);
  return next;
}

function doPlayUnit(
  state: GameState,
  action: Extract<Action, { type: "playUnit" }>,
): void {
  if (state.phase !== "commitment" || state.turn !== action.player) return;
  const p = state.players[action.player];
  if (p.flags.unitsClosed || state.turnActions.unitPlayed) return;
  if (ownerOfSlot(action.slot) !== action.player || state.board[action.slot]) return;

  const index = p.unitHand.findIndex((c) => c.uid === action.uid);
  if (index === -1) return;
  const card = getUnit(p.unitHand[index].cardId);
  if (card.cost > remainingCap(state, action.player)) return;

  const faceDown = action.faceDown === true;
  if (faceDown) {
    if (!canHide(state, action.player, action.uid)) return;
    const payIndex = p.unitHand.findIndex((c) => c.uid === action.discardUid && c.uid !== action.uid);
    if (payIndex === -1) return;
    const [paid] = p.unitHand.splice(payIndex, 1);
    p.discard.push(paid);
    p.hiddenThisLocation += 1;
    log(state, `Rejtett egység, ára: ${getUnit(paid.cardId).name} eldobva.`, action.player);
  }

  const handIndex = p.unitHand.findIndex((c) => c.uid === action.uid);
  const [handCard] = p.unitHand.splice(handIndex, 1);
  p.capSpent += card.cost;

  const unit = makeUnitInstance(handCard.uid, handCard.cardId, action.player, action.slot, {
    order: state.placementCounter++,
    paidCost: card.cost,
    faceDown,
  });
  state.board[action.slot] = unit;
  state.turnActions.unitPlayed = true;
  log(
    state,
    faceDown ? `Lapjával lefelé egy egység ide: ${action.slot}.` : `${card.name} ide: ${action.slot}.`,
    action.player,
  );

  // Belépő fires the moment the unit is placed — unless it is hidden, in which
  // case it waits for reveal. That delay is the main reason to pay for hiding.
  if (!faceDown) fireBelepo(state, unit);
}

function doStackSpell(state: GameState, action: Extract<Action, { type: "stackSpell" }>): void {
  if (state.phase !== "commitment" || state.turn !== action.player) return;
  const p = state.players[action.player];
  if (p.flags.spellsClosed || state.turnActions.spellPlayed) return;
  const index = p.spellHand.findIndex((c) => c.uid === action.uid);
  if (index === -1) return;
  const [card] = p.spellHand.splice(index, 1);
  state.stack.push({
    uid: card.uid,
    owner: action.player,
    cardId: card.cardId,
    order: state.stack.length,
  });
  state.turnActions.spellPlayed = true;
  // Ownership and stack height are public. Contents are not.
  log(state, `Egy varázslat a pakliba (${state.stack.length}. hely).`, action.player);
}

function passTurn(state: GameState): void {
  state.turn = other(state.turn);
  state.turnActions = { unitPlayed: false, spellPlayed: false };
}

// ---------------------------------------------------------------------------
// settle — auto-closing, phase transitions, skipping finished players
// ---------------------------------------------------------------------------

function autoCloseFlags(state: GameState): void {
  for (const id of PLAYERS) {
    const p = state.players[id];
    if (!p.flags.unitsClosed) {
      const boardFull = emptySlotsOf(state, id).length === 0;
      const nothingAffordable = p.unitHand.length === 0;
      if (boardFull || nothingAffordable) {
        p.flags.unitsClosed = true;
        log(state, boardFull ? "Egységek: kész (tele a rács)." : "Egységek: kész (üres kéz).", id);
      }
    }
    if (!p.flags.spellsClosed && p.spellHand.length === 0) {
      p.flags.spellsClosed = true;
      log(state, "Varázslatok: kész (üres kéz).", id);
    }
  }
}

function allFlagsClosed(state: GameState): boolean {
  return PLAYERS.every((id) => {
    const f = state.players[id].flags;
    return f.unitsClosed && f.spellsClosed;
  });
}

function bothClosed(state: GameState, player: PlayerId): boolean {
  const f = state.players[player].flags;
  return f.unitsClosed && f.spellsClosed;
}

export function settle(state: GameState): void {
  if (state.phase === "gameOver") return;

  if (state.phase === "commitment") {
    autoCloseFlags(state);
    if (allFlagsClosed(state)) {
      doReveal(state);
      state.phase = "spells";
      beginResolution(state);
    } else {
      // A player with both flags closed is skipped; the opponent keeps taking
      // turns alone until every flag is down.
      let guard = 0;
      while (bothClosed(state, state.turn) && guard++ < 4) passTurn(state);
    }
  }

  if (state.phase === "spells") {
    if (state.resolution && !state.resolution.pending) {
      advanceResolution(state);
    }
    if (resolutionFinished(state) && !state.resolution?.pending) {
      scoreLocation(state);
    }
  }
}

function doReveal(state: GameState): void {
  state.phase = "reveal";
  const hidden = ALL_SLOTS.map((s) => state.board[s])
    .filter((u): u is NonNullable<typeof u> => !!u && u.faceDown)
    .sort((a, b) => a.order - b.order);
  for (const unit of hidden) {
    unit.faceDown = false;
    log(state, `Felfedve: ${cardOf(unit).name} (${unit.slot}).`, unit.owner);
  }
  // Belépő abilities of hidden units fire now, in placement order.
  for (const unit of hidden) {
    if (state.board[unit.slot]?.uid === unit.uid) fireBelepo(state, unit);
  }
}

function scoreLocation(state: GameState): void {
  state.phase = "scored";
  state.resolution = null;
  const t = totals(state);
  const winner = locationWinner(state);
  const loc = state.locations[state.locationIndex];
  loc.winner = winner;
  loc.totals = t;
  const name = getLocation(loc.cardId).name;
  log(
    state,
    winner === "void"
      ? `${name}: döntetlen (${t.p1}–${t.p2}), senki nem szerzi meg.`
      : `${name}: ${winner} nyeri (${t.p1}–${t.p2}).`,
  );
  state.scores = scoreboard(state);
}

// ---------------------------------------------------------------------------
// Location turnover
// ---------------------------------------------------------------------------

function startNextLocation(state: GameState): void {
  if (state.phase !== "scored") return;

  // Spent cards are gone, win or lose.
  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    if (unit) state.players[unit.owner].discard.push({ uid: unit.uid, cardId: unit.cardId });
    state.board[slot] = null;
  }
  for (const entry of state.stack) {
    state.players[entry.owner].discard.push({ uid: entry.uid, cardId: entry.cardId });
  }
  state.stack = [];
  state.placementCounter = 0;

  // No toss. You keep whatever you did not spend, and refill only what left.
  for (const id of PLAYERS) {
    const p = state.players[id];
    p.flags = { unitsClosed: false, spellsClosed: false };
    p.capSpent = 0;
    p.hiddenThisLocation = 0;
    drawUpTo(p.unitHand, p.unitDeck, state.config.handSize);
    drawUpTo(p.spellHand, p.spellDeck, state.config.spellHandSize);
  }

  const played = state.locationIndex + 1;
  const board = scoreboard(state);
  const regularCount = state.locations.filter((l) => !getLocation(l.cardId).tiebreaker).length;

  if (played >= state.locations.length) {
    finishGame(state);
    return;
  }
  if (played >= regularCount && board.p1 !== board.p2) {
    // Végtelen puszta is played only if the score is tied.
    finishGame(state);
    return;
  }

  state.locationIndex = played;
  state.phase = "commitment";
  state.turn = state.locations[state.locationIndex].broughtBy;
  state.turnActions = { unitPlayed: false, spellPlayed: false };
  const loc = getLocation(state.locations[state.locationIndex].cardId);
  log(
    state,
    `${loc.name} — költségkeret ${loc.cap === null ? "nincs" : loc.cap}. Kezd: ${state.turn}.`,
  );
  settle(state);
}

function finishGame(state: GameState): void {
  const board = scoreboard(state);
  state.phase = "gameOver";
  state.scores = board;
  state.winner = board.p1 > board.p2 ? "p1" : board.p2 > board.p1 ? "p2" : "draw";
  log(state, `Vége: ${board.p1}–${board.p2} (${state.winner}).`);
}

function drawUpTo(hand: { uid: string; cardId: string }[], deck: { uid: string; cardId: string }[], size: number): void {
  while (hand.length < size && deck.length > 0) {
    hand.push(deck.shift()!);
  }
}

// ---------------------------------------------------------------------------
// Convenience selectors used by both the UI and the simulator
// ---------------------------------------------------------------------------

export function activePlayer(state: GameState): PlayerId | null {
  if (state.phase === "commitment") return state.turn;
  if (state.phase === "spells") return state.resolution?.pending?.player ?? null;
  if (state.phase === "scored") return state.turn;
  return null;
}

export function stackDescription(state: GameState): { owner: PlayerId; revealed: boolean; cardId: string }[] {
  const revealed = state.phase === "spells" || state.phase === "scored" || state.phase === "gameOver";
  return state.stack.map((e) => ({ owner: e.owner, revealed, cardId: e.cardId }));
}

export function spellName(cardId: string): string {
  return getSpell(cardId).name;
}

export function boardUnits(state: GameState, player: PlayerId) {
  return unitsOf(state, player);
}
