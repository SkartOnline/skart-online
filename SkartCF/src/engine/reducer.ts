import { getLocation, getSpell, getUnit } from "./cards";
import { fireTrigger, isBlocked, makeUnitInstance, openSlots, runEffects } from "./effects";
import { ALL_SLOTS, orthogonalNeighbours, ownerOfSlot, slotsOf } from "./grid";
import {
  cardKeywords,
  cardOf,
  currentLocation,
  effectiveCost,
  castingBanned,
  isMasterSpell,
  unitsOf,
} from "./power";
import {
  advanceResolution,
  beginCast,
  chooseHandCard,
  chooseSlot,
  fireBelepo,
  hasViableCaster,
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
 * Returns an empty array when the player has stopped in the phase that is
 * running, and the turn loop skips them rather than ending the phase. Each
 * phase ends only when both of its flags are down.
 *
 * There is no passing. Playing ends your turn on its own, so the only other
 * thing on offer is stopping, which is permanent for the rest of the location.
 *
 * The two flags belong to different phases now: `unitsClosed` gates the units
 * phase, `spellsClosed` the battle. There is no longer a moment where both are
 * live at once.
 */
export function legalActions(state: GameState, player: PlayerId): Action[] {
  const out: Action[] = [];

  // A spell in mid-resolution owns the whole turn: only the caster answers, and
  // nothing else may be played until it has finished with the board.
  const pending = state.resolution?.pending;
  if (pending) {
    if (pending.player !== player) return out;
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

  if (state.turn !== player) return out;

  const p = state.players[player];

  if (state.phase === "units") {
    if (!p.flags.unitsClosed && !state.turnActions.unitPlayed) {
      const free = emptySlotsOf(state, player);
      const cap = remainingCap(state, player);
      for (const card of playablePile(state, player)) {
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
          // Hiding is offered once per card that could pay for it, so the
          // player picks what to lose rather than being handed a default.
          if (canPay) {
            for (const payment of p.unitHand) {
              if (payment.uid === card.uid) continue;
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
    if (!p.flags.unitsClosed) out.push({ type: "declareUnitsDone", player });
    return out;
  }

  if (state.phase === "battle") {
    // A Mesteri spell begun last turn owns this one. Finishing it is mandatory
    // and costs a spell out of hand, so nothing else is on offer.
    const channel = state.channel[player];
    if (channel) {
      for (const card of p.spellHand) {
        out.push({ type: "finishChannel", player, discardUid: card.uid });
      }
      return out;
    }
    // Omen stops anyone casting at all while it stands.
    if (!p.flags.spellsClosed && !state.turnActions.spellPlayed && !castingBanned(state)) {
      for (const card of p.spellHand) {
        // A spell no unit of yours can fund or aim is not castable at all.
        if (!hasViableCaster(state, getSpell(card.cardId), player)) continue;
        out.push({ type: "castSpell", player, uid: card.uid });
      }
    }
    if (!p.flags.spellsClosed) out.push({ type: "declareSpellsDone", player });
  }

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
    case "castSpell":
      doCastSpell(next, action);
      break;
    case "finishChannel":
      doFinishChannel(next, action);
      break;
    case "declareUnitsDone":
      if (next.phase === "units" && next.turn === action.player) {
        next.players[action.player].flags.unitsClosed = true;
        log(next, "Egységek: kész.", action.player);
      }
      break;
    case "declareSpellsDone":
      if (next.phase === "battle" && next.turn === action.player) {
        next.players[action.player].flags.spellsClosed = true;
        log(next, "Varázslatok: kész.", action.player);
      }
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
  if (state.phase !== "units" || state.turn !== action.player) return;
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

  // Belépő fires the moment the unit is placed, unless it is hidden, in which
  // case it waits for reveal. That delay is the main reason to pay for hiding.
  if (!faceDown) fireBelepo(state, unit);

  // Committing a unit is the whole turn. Stopping is the alternative to playing
  // one, never something you announce after having played.
  passTurn(state);
}

/**
 * A spell is played open in the battle phase and goes off on the spot. The turn
 * does not pass here, `settle` releases it once the spell has stopped asking
 * for picks, which may be several actions later.
 */
function doCastSpell(state: GameState, action: Extract<Action, { type: "castSpell" }>): void {
  if (state.phase !== "battle" || state.turn !== action.player) return;
  const p = state.players[action.player];
  if (state.channel[action.player]) return; // finish what you started first
  if (p.flags.spellsClosed || state.turnActions.spellPlayed) return;
  if (state.resolution) return; // one spell finishes before the next begins
  if (castingBanned(state)) return;
  const index = p.spellHand.findIndex((c) => c.uid === action.uid);
  if (index === -1) return;
  const spell = getSpell(p.spellHand[index].cardId);
  if (!hasViableCaster(state, spell, action.player)) return;
  const [card] = p.spellHand.splice(index, 1);

  // A Mesteri spell goes down face-down and does nothing this turn. The
  // opponent learns only that one is coming.
  if (isMasterSpell(spell)) {
    state.channel[action.player] = { uid: card.uid, cardId: card.cardId };
    state.turnActions.spellPlayed = true;
    log(state, "Mesteri varázslatba kezdett.", action.player);
    passTurn(state);
    return;
  }

  state.spellsCast.push({
    uid: card.uid,
    owner: action.player,
    cardId: card.cardId,
    order: state.spellsCast.length,
  });
  state.turnActions.spellPlayed = true;
  log(state, `${spell.name} kijátszva.`, action.player);
  beginCast(state, state.spellsCast.length - 1);
}

/**
 * The second half of a Mesteri cast. It costs a spell out of hand and is
 * mandatory, so it happens whether or not the spell can still do anything.
 */
function doFinishChannel(
  state: GameState,
  action: Extract<Action, { type: "finishChannel" }>,
): void {
  if (state.phase !== "battle" || state.turn !== action.player) return;
  if (state.resolution) return;
  const channel = state.channel[action.player];
  if (!channel) return;
  const p = state.players[action.player];
  const index = p.spellHand.findIndex((c) => c.uid === action.discardUid);
  if (index === -1) return;

  const [toss] = p.spellHand.splice(index, 1);
  p.discard.push(toss);
  state.channel[action.player] = null;
  state.spellsCast.push({
    uid: channel.uid,
    owner: action.player,
    cardId: channel.cardId,
    order: state.spellsCast.length,
  });
  state.turnActions.spellPlayed = true;
  log(
    state,
    `${getSpell(channel.cardId).name} befejezve, ára ${getSpell(toss.cardId).name}.`,
    action.player,
  );
  beginCast(state, state.spellsCast.length - 1);
}

function passTurn(state: GameState): void {
  state.turn = other(state.turn);
  state.turnActions = { unitPlayed: false, spellPlayed: false };
}

// ---------------------------------------------------------------------------
// settle, auto-closing, phase transitions, skipping finished players
// ---------------------------------------------------------------------------

function autoCloseUnits(state: GameState): void {
  for (const id of PLAYERS) {
    const p = state.players[id];
    if (p.flags.unitsClosed) continue;
    const boardFull = emptySlotsOf(state, id).length === 0;
    const handEmpty = playablePile(state, id).length === 0;
    if (boardFull || handEmpty) {
      p.flags.unitsClosed = true;
      log(state, boardFull ? "Egységek: kész (tele a rács)." : "Egységek: kész (üres kéz).", id);
    }
  }
}

/**
 * Finishing a Mesteri spell costs a spell out of hand. With nothing left to pay
 * with, or with casting shut down entirely, the channelled spell is lost.
 */
function fizzleDeadChannels(state: GameState): void {
  const banned = castingBanned(state);
  for (const id of PLAYERS) {
    const channel = state.channel[id];
    if (!channel) continue;
    if (state.players[id].spellHand.length > 0 && !banned) continue;
    state.channel[id] = null;
    state.players[id].discard.push({ uid: channel.uid, cardId: channel.cardId });
    log(state, `${getSpell(channel.cardId).name} elszáll, nincs mivel befejezni.`, id);
  }
}

function autoCloseSpells(state: GameState): void {
  const banned = castingBanned(state);
  for (const id of PLAYERS) {
    const p = state.players[id];
    if (p.flags.spellsClosed || state.channel[id]) continue;
    if (p.spellHand.length === 0 || banned) {
      p.flags.spellsClosed = true;
      log(state, banned ? "Varázslatok: kész (nem lehet varázsolni)." : "Varázslatok: kész (üres kéz).", id);
    }
  }
}

const bothStopped = (state: GameState, flag: "unitsClosed" | "spellsClosed"): boolean =>
  PLAYERS.every((id) => state.players[id].flags[flag]);

/**
 * Hands the turn on until it lands on somebody who can still act. A player
 * owing an unfinished Mesteri spell always can, whatever their flag says.
 */
function skipStopped(state: GameState, flag: "unitsClosed" | "spellsClosed"): void {
  let guard = 0;
  while (
    state.players[state.turn].flags[flag] &&
    !(flag === "spellsClosed" && state.channel[state.turn]) &&
    guard++ < 4
  ) {
    passTurn(state);
  }
}

export function settle(state: GameState): void {
  if (state.phase === "gameOver") return;

  if (state.phase === "units") {
    autoCloseUnits(state);
    if (!bothStopped(state, "unitsClosed")) {
      skipStopped(state, "unitsClosed");
      return;
    }
    runMustra(state);
  }

  if (state.phase === "battle") {
    // A spell holds the turn until it has finished asking for picks.
    if (state.resolution) {
      if (state.resolution.pending) return;
      advanceResolution(state);
      if (state.resolution.pending) return;
      if (!resolutionFinished(state)) return;
      state.resolution = null;
      passTurn(state);
    }

    fizzleDeadChannels(state);
    autoCloseSpells(state);
    // A player still owing a Mesteri spell has not finished the battle, even
    // with both flags down.
    const owing = PLAYERS.some((id) => state.channel[id]);
    if (!owing && bothStopped(state, "spellsClosed")) {
      scoreLocation(state);
      return;
    }
    skipStopped(state, "spellsClosed");
  }
}

/**
 * Mustra: every unit is down, the hidden ones turn face up, and the battle
 * opens. A face-down unit's Belépő waited for this moment, that delay is the
 * main reason to pay for hiding one. Mustra abilities fire here too, after
 * every Belépő has landed, so Szarvas advances into a settled board.
 */
function runMustra(state: GameState): void {
  state.phase = "mustra";
  log(state, "Mustra, a rejtett egységek felfedve, jöhet a csata.");

  const hidden = ALL_SLOTS.map((s) => state.board[s])
    .filter((u): u is NonNullable<typeof u> => !!u && u.faceDown)
    .sort((a, b) => a.order - b.order);
  for (const unit of hidden) {
    unit.faceDown = false;
    log(state, `Felfedve: ${cardOf(unit).name} (${unit.slot}).`, unit.owner);
  }
  for (const unit of hidden) {
    if (state.board[unit.slot]?.uid === unit.uid) fireBelepo(state, unit);
  }

  fireTrigger(state, "onMustra", null, (text) => log(state, text));

  state.phase = "battle";
  // The player who brought the battlefield opens the battle too, same as the
  // units phase, casting first now costs information rather than buying it.
  state.turn = state.locations[state.locationIndex].broughtBy;
  state.turnActions = { unitPlayed: false, spellPlayed: false };
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

  // Diadal and Vigasz are outcome triggers, not death triggers: they ask
  // whether the unit is standing here when the location is decided, and fire
  // for the winning side and the losing side respectively. A tied location
  // fires neither, because nobody won and nobody lost.
  if (winner !== "void") {
    const loser = other(winner);
    fireTrigger(state, "onLocationWon", null, (text) => log(state, text, winner), winner);
    fireTrigger(state, "onLocationLost", null, (text) => log(state, text, loser), loser);
  }

  state.scores = scoreboard(state);
}

// ---------------------------------------------------------------------------
// Location turnover
// ---------------------------------------------------------------------------

function startNextLocation(state: GameState): void {
  if (state.phase !== "scored") return;

  // Spent cards are gone, win or lose, except what Csábítás claimed.
  for (const slot of ALL_SLOTS) {
    const unit = state.board[slot];
    if (unit) {
      const card = { uid: unit.uid, cardId: unit.cardId };
      if (unit.claimedBy) state.players[unit.claimedBy].unitHand.push(card);
      else state.players[unit.owner].discard.push(card);
    }
    state.board[slot] = null;
  }
  for (const entry of state.spellsCast) {
    state.players[entry.owner].discard.push({ uid: entry.uid, cardId: entry.cardId });
  }
  for (const id of PLAYERS) {
    const channel = state.channel[id];
    if (channel) state.players[id].discard.push({ uid: channel.uid, cardId: channel.cardId });
    state.channel[id] = null;
  }
  state.spellsCast = [];
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
  // Taking more than half the regular battlefields settles it: the rest cannot
  // be caught up, so there is nothing left to play for.
  const majority = Math.floor(regularCount / 2) + 1;
  if (board.p1 >= majority || board.p2 >= majority) {
    finishGame(state);
    return;
  }
  if (played >= regularCount && board.p1 !== board.p2) {
    // Végtelen puszta is played only if the score is tied.
    finishGame(state);
    return;
  }

  state.locationIndex = played;
  state.phase = "units";
  state.turn = state.locations[state.locationIndex].broughtBy;
  state.turnActions = { unitPlayed: false, spellPlayed: false };
  const loc = getLocation(state.locations[state.locationIndex].cardId);
  log(
    state,
    `${loc.name}, költségkeret ${loc.cap === null ? "nincs" : loc.cap}. Kezd: ${state.turn}.`,
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
  if (state.phase === "units" || state.phase === "battle") return state.turn;
  if (state.phase === "scored") return state.turn;
  return null;
}

/** Spells cast this location, in play order. All of them are public. */
export function castDescription(state: GameState): { owner: PlayerId; cardId: string }[] {
  return state.spellsCast.map((e) => ({ owner: e.owner, cardId: e.cardId }));
}

export function spellName(cardId: string): string {
  return getSpell(cardId).name;
}

export function boardUnits(state: GameState, player: PlayerId) {
  return unitsOf(state, player);
}

/** Exposed for the UI's slot rendering, a chasm draws differently. */
export function blockedSlotsOf(state: GameState, player: PlayerId): SlotId[] {
  return slotsOf(player).filter((s) => isBlocked(state, s));
}

