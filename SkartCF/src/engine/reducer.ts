import { getLocation, getSpell, getUnit } from "./cards";
import { fireTrigger, isBlocked, makeUnitInstance, openSlots, runEffects } from "./effects";
import { ALL_SLOTS, orthogonalNeighbours, ownerOfSlot, slotsOf } from "./grid";
import {
  cardKeywords,
  cardOf,
  currentLocation,
  effectiveCost,
  stackingBanned,
  unitsOf,
} from "./power";
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
import type { Action, GameState, HandCard, PlayerId, SlotId, UnitCard } from "./types";
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
  return openSlots(state, player);
}

// ---------------------------------------------------------------------------
// Location rules that gate placement
// ---------------------------------------------------------------------------

/** Umbra lets the graveyard act as an extension of the hand. */
function playablePile(state: GameState, player: PlayerId): HandCard[] {
  const p = state.players[player];
  const fromGrave = (currentLocation(state).effects ?? []).some(
    (e) => e.kind === "playFromGraveyard",
  );
  if (!fromGrave) return p.unitHand;
  return [...p.unitHand, ...p.discard.filter((c) => tryUnit(c.cardId))];
}

function tryUnit(id: string): UnitCard | undefined {
  try {
    return getUnit(id);
  } catch {
    return undefined;
  }
}

/** Papagáj may only land next to a Kalóz. */
function placementAllowed(
  state: GameState,
  card: UnitCard,
  player: PlayerId,
  slot: SlotId,
): boolean {
  for (const ability of card.statics ?? []) {
    if (ability.kind !== "placementRule") continue;
    const keyword = String(ability.requireAdjacentKeyword ?? "");
    if (!keyword) continue;
    const ok = orthogonalNeighbours(slot).some((s) => {
      const neighbour = state.board[s];
      return (
        neighbour &&
        neighbour.owner === player &&
        cardKeywords(getUnit(neighbour.cardId)).includes(keyword)
      );
    });
    if (!ok) return false;
  }
  return true;
}

/** Feketepiac and Ködrét turn units face-down on arrival, for free. */
function autoHidden(state: GameState, card: UnitCard): boolean {
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "autoHide") continue;
    const keyword = effect.keyword ? String(effect.keyword) : "";
    if (!keyword || cardKeywords(card).includes(keyword)) return true;
  }
  return false;
}

/** How many unit cards hiding this one costs. Feketepiac charges double. */
export function hideCost(state: GameState, card: UnitCard): number {
  let cost = 1;
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "hideCostMod") continue;
    const except = effect.exceptKeyword ? String(effect.exceptKeyword) : "";
    if (except && cardKeywords(card).includes(except)) continue;
    cost = Math.max(cost, Number(effect.cost ?? 1));
  }
  return cost;
}

/** Umbradog refuses to be hidden. */
function cardForbidsHiding(card: UnitCard): boolean {
  return (card.statics ?? []).some((a) => a.kind === "selfGrant" && a.grant === "cannotHide");
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
  const pile = playablePile(state, player);

  if (!p.flags.unitsClosed && !state.turnActions.unitPlayed) {
    for (const card of pile) {
      const unitCard = getUnit(card.cardId);
      if (effectiveCost(unitCard, state) > cap) continue;
      const toll = hideCost(state, unitCard);
      const canPay =
        !cardForbidsHiding(unitCard) &&
        !autoHidden(state, unitCard) &&
        p.unitHand.filter((c) => c.uid !== card.uid).length >= toll;
      for (const slot of free) {
        if (!placementAllowed(state, unitCard, player, slot)) continue;
        out.push({ type: "playUnit", player, uid: card.uid, slot });
        if (canPay) {
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

  // Omen shuts the rakás for both players while it stands.
  if (!p.flags.spellsClosed && !state.turnActions.spellPlayed && !stackingBanned(state)) {
    for (const card of p.spellHand) {
      out.push({ type: "stackSpell", player, uid: card.uid });
    }
  }

  if (!p.flags.unitsClosed) out.push({ type: "declareUnitsDone", player });
  if (!p.flags.spellsClosed) out.push({ type: "declareSpellsDone", player });
  out.push({ type: "endTurn", player });

  return out;
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

/** Pulls a card out of the hand, or out of the graveyard when Umbra allows it. */
function takeFromPile(state: GameState, player: PlayerId, uid: string): HandCard | null {
  const p = state.players[player];
  const handIndex = p.unitHand.findIndex((c) => c.uid === uid);
  if (handIndex !== -1) return p.unitHand.splice(handIndex, 1)[0];
  const fromGrave = (currentLocation(state).effects ?? []).some(
    (e) => e.kind === "playFromGraveyard",
  );
  if (!fromGrave) return null;
  const graveIndex = p.discard.findIndex((c) => c.uid === uid && tryUnit(c.cardId));
  if (graveIndex === -1) return null;
  return p.discard.splice(graveIndex, 1)[0];
}

function doPlayUnit(state: GameState, action: Extract<Action, { type: "playUnit" }>): void {
  if (state.phase !== "commitment" || state.turn !== action.player) return;
  const p = state.players[action.player];
  if (p.flags.unitsClosed || state.turnActions.unitPlayed) return;
  if (ownerOfSlot(action.slot) !== action.player || state.board[action.slot]) return;
  if (isBlocked(state, action.slot)) return;

  const source = playablePile(state, action.player).find((c) => c.uid === action.uid);
  if (!source) return;
  const card = getUnit(source.cardId);
  const cost = effectiveCost(card, state);
  if (cost > remainingCap(state, action.player)) return;
  if (!placementAllowed(state, card, action.player, action.slot)) return;

  let faceDown = action.faceDown === true;
  if (faceDown) {
    if (cardForbidsHiding(card) || autoHidden(state, card)) return;
    const toll = hideCost(state, card);
    const payable = p.unitHand.filter((c) => c.uid !== action.uid);
    if (payable.length < toll) return;
    // The named card goes first, then the cheapest others make up the difference.
    const chosen = payable.filter((c) => c.uid === action.discardUid);
    for (const c of payable) {
      if (chosen.length >= toll) break;
      if (!chosen.includes(c)) chosen.push(c);
    }
    for (const c of chosen.slice(0, toll)) {
      const index = p.unitHand.findIndex((x) => x.uid === c.uid);
      if (index !== -1) p.discard.push(...p.unitHand.splice(index, 1));
    }
    p.hiddenThisLocation += 1;
    log(state, `Rejtett egység, ára ${toll} egységlap.`, action.player);
  } else if (autoHidden(state, card)) {
    // Feketepiac and Ködrét hide on arrival, and it costs nothing.
    faceDown = true;
  }

  const handCard = takeFromPile(state, action.player, action.uid);
  if (!handCard) return;
  p.capSpent += cost;

  const unit = makeUnitInstance(handCard.uid, handCard.cardId, action.player, action.slot, {
    order: state.placementCounter++,
    paidCost: cost,
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
  if (stackingBanned(state)) return;
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
  // Ownership and rakás height are public. Contents are not.
  log(state, `Egy varázslat a rakásra (${state.stack.length}. hely).`, action.player);
  // Nothing can follow a spell in the same turn, so the turn passes on its own.
  passTurn(state);
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
      const nothingAffordable = playablePile(state, id).length === 0;
      if (boardFull || nothingAffordable) {
        p.flags.unitsClosed = true;
        log(state, boardFull ? "Egységek: kész (tele a rács)." : "Egységek: kész (üres kéz).", id);
      }
    }
    if (!p.flags.spellsClosed && (p.spellHand.length === 0 || stackingBanned(state))) {
      p.flags.spellsClosed = true;
      log(state, "Varázslatok: kész (nincs mit tenni a rakásra).", id);
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

  // Diadal fires for the winner only, before the board is cleared.
  if (winner !== "void") {
    for (const unit of unitsOf(state, winner)) {
      for (const trigger of cardOf(unit).triggers ?? []) {
        if (trigger.on !== "onLocationWon") continue;
        runEffects(state, unit, winner, trigger.effects, [unit.slot], (text) => log(state, text, winner));
      }
    }
  }

  state.scores = scoreboard(state);
}

// ---------------------------------------------------------------------------
// Location turnover
// ---------------------------------------------------------------------------

function startNextLocation(state: GameState): void {
  if (state.phase !== "scored") return;

  // Spent cards are gone, win or lose — except what Csábítás claimed.
  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    if (unit) {
      const card = { uid: unit.uid, cardId: unit.cardId };
      if (unit.claimedBy) state.players[unit.claimedBy].unitHand.push(card);
      else state.players[unit.owner].discard.push(card);
    }
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
    drawUpTo(p.unitHand, p.unitDeck, state.config.handSize + p.bonusDraw.units);
    drawUpTo(p.spellHand, p.spellDeck, state.config.spellHandSize + p.bonusDraw.spells);
    p.bonusDraw = { units: 0, spells: 0 };
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
  applyLocationStart(state);
  settle(state);
}

/**
 * Lingadori könyvtár, Malom and Bőségkert all hand both players the same thing
 * before a card is committed. One location effect, three parameter sets.
 */
export function applyLocationStart(state: GameState): void {
  for (const effect of currentLocation(state).effects ?? []) {
    if (effect.kind !== "startEffect") continue;
    const kinds = effect.cardKind === "both" ? ["unit", "spell"] : [String(effect.cardKind ?? "spell")];
    for (const player of PLAYERS) {
      for (const cardKind of kinds) {
        runEffects(
          state,
          null,
          player,
          [{ kind: String(effect.effect ?? "draw"), cardKind, count: Number(effect.count ?? 1) }],
          [],
          (text) => log(state, text, player),
        );
      }
    }
  }
  fireTrigger(state, "onLocationStart", null, (text) => log(state, text));
}

function finishGame(state: GameState): void {
  const board = scoreboard(state);
  state.phase = "gameOver";
  state.scores = board;
  state.winner = board.p1 > board.p2 ? "p1" : board.p2 > board.p1 ? "p2" : "draw";
  log(state, `Vége: ${board.p1}–${board.p2} (${state.winner}).`);
}

function drawUpTo(hand: HandCard[], deck: HandCard[], size: number): void {
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

export function stackDescription(
  state: GameState,
): { owner: PlayerId; revealed: boolean; cardId: string }[] {
  const revealed = state.phase === "spells" || state.phase === "scored" || state.phase === "gameOver";
  return state.stack.map((e) => ({ owner: e.owner, revealed, cardId: e.cardId }));
}

export function spellName(cardId: string): string {
  return getSpell(cardId).name;
}

export function boardUnits(state: GameState, player: PlayerId) {
  return unitsOf(state, player);
}

/** Exposed for the UI's slot rendering — a chasm draws differently. */
export function blockedSlotsOf(state: GameState, player: PlayerId): SlotId[] {
  return slotsOf(player).filter((s) => isBlocked(state, s));
}

