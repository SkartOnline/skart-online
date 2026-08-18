import { getSpell, getUnit } from "./cards";
import { applyEffect, flipCoin, isBlocked, legalDestinations, sweepDead, trapSlots } from "./effects";
import type { EffectContext } from "./effects";
import { ALL_SLOTS, opponentOf, ownerOfSlot, slotLabel, slotsOf } from "./grid";
import { cardOf, matchesFilter } from "./power";
import { askPrompt, pendingPrompt, promptOptions, promptSatisfied, recordReveal } from "./prompts";
import { randomInt } from "./rng";
import type {
  Effect,
  GameState,
  HandCard,
  PlayerId,
  Portal,
  Prompt,
  SlotId,
  SpellCard,
  Trap,
  UnitInstance,
} from "./types";

/**
 * What happens once an ability has been answered, plus the two zones the rules
 * do not have and four cards need: Fuedrax's traps and Felix's portal.
 *
 * One handler per prompt kind, keyed by string, the same shape `effects.ts`
 * uses and for the same reason — the engine never branches on a card id, and a
 * prompt has to survive being cloned.
 */

export type PromptHandler = (state: GameState, prompt: Prompt, log: (text: string) => void) => void;

// ---------------------------------------------------------------------------
// Queue mechanics
// ---------------------------------------------------------------------------

/**
 * One pick. Reaching the maximum closes the prompt on its own: a card that says
 * "up to three" and has been given three is not still asking.
 */
export function answerPrompt(state: GameState, pick: string, log: (text: string) => void): void {
  const prompt = pendingPrompt(state);
  if (!prompt) return;
  if (!promptOptions(prompt).includes(pick)) return;
  prompt.chosen.push(pick);
  if (prompt.chosen.length >= prompt.max) closePrompt(state, log);
}

/** Stop picking. Only legal once the ability has had the minimum it asked for. */
export function finishPrompt(state: GameState, log: (text: string) => void): void {
  const prompt = pendingPrompt(state);
  if (!prompt || !promptSatisfied(prompt)) return;
  closePrompt(state, log);
}

function closePrompt(state: GameState, log: (text: string) => void): void {
  const prompt = state.prompts.shift();
  if (!prompt) return;
  const handler = PROMPT_HANDLERS[prompt.kind];
  if (!handler) throw new Error(`No handler for prompt kind "${prompt.kind}"`);
  handler(state, prompt, log);
  sweepDead(state, log);
}

/**
 * A prompt nobody can answer never reaches the player: an empty graveyard has
 * nothing to tutor out of, and a hand with three cards cannot be asked for a
 * fourth. Its handler still runs, on however many picks it got, because a chain
 * like Griff's — take, then hand back what you took — has to keep going when
 * the first half came up empty.
 */
export function settlePrompts(state: GameState, log: (text: string) => void): void {
  let guard = 0;
  while (guard++ < 24) {
    const prompt = pendingPrompt(state);
    if (!prompt) return;
    const left = promptOptions(prompt).length;
    if (left > 0 && prompt.chosen.length < prompt.max) return;
    closePrompt(state, log);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handOf(state: GameState, player: PlayerId, kind: string): HandCard[] {
  return kind === "unit" ? state.players[player].unitHand : state.players[player].spellHand;
}

function takeByUid(pile: HandCard[], uid: string): HandCard | null {
  const index = pile.findIndex((c) => c.uid === uid);
  return index === -1 ? null : pile.splice(index, 1)[0];
}

function nameOf(cardId: string): string {
  try {
    return getUnit(cardId).name;
  } catch {
    try {
      return getSpell(cardId).name;
    } catch {
      return cardId;
    }
  }
}

export const PROMPT_HANDLERS: Record<string, PromptHandler> = {
  /**
   * Kikeresés with the player's eyes open.
   *
   * The engine used to take the first card that matched, which meant Sírásó
   * searched your graveyard *for* you and handed you whatever was nearest the
   * front. Searching a pile is the whole card; the pile is listed, the player
   * points, and what they pointed at comes up into the hand.
   */
  tutor(state, prompt, log) {
    const player = prompt.player;
    const cardKind = String(prompt.data?.cardKind ?? "spell");
    const source = String(prompt.data?.source ?? "deck");
    const p = state.players[player];
    const pile =
      source === "graveyard" ? p.discard : cardKind === "unit" ? p.unitDeck : p.spellDeck;
    const hand = handOf(state, player, cardKind);
    const taken: string[] = [];
    for (const uid of prompt.chosen) {
      const card = takeByUid(pile, uid);
      if (!card) continue;
      hand.push(card);
      taken.push(card.cardId);
    }
    if (taken.length === 0) return;
    log(`Kikeresve: ${taken.map(nameOf).join(", ")}.`);
    recordReveal(state, {
      kind: "tutor",
      player,
      cardIds: taken,
      sourceCardId: prompt.sourceCardId,
    });
  },

  /**
   * Griff, the first half. The cards come across all at once, after every pick
   * is in rather than one at a time: the card says you draw them, not that you
   * draw one and then get to look again.
   */
  griffTake(state, prompt, log) {
    const player = prompt.player;
    const victim = opponentOf(player);
    const theirs = state.players[victim].unitHand;
    const mine = state.players[player].unitHand;
    const taken: string[] = [];
    for (const uid of prompt.chosen) {
      const card = takeByUid(theirs, uid);
      if (!card) continue;
      mine.push(card);
      taken.push(card.cardId);
    }
    if (taken.length === 0) return;
    log(`Griff elhúz ${taken.length} egységlapot: ${taken.map(nameOf).join(", ")}.`);
    recordReveal(state, {
      kind: "peek",
      player,
      cardIds: taken,
      sourceCardId: prompt.sourceCardId,
    });

    // The debt is settled straight away, and it is a debt: the same number goes
    // back, though nothing says it has to be the same cards.
    askPrompt(state, {
      kind: "griffGive",
      player,
      prompt: `Adj vissza ${taken.length} egységlapot`,
      picking: "card",
      cards: mine.slice(),
      min: taken.length,
      max: taken.length,
      sourceCardId: prompt.sourceCardId,
    });
  },

  /** Griff, the second half. Same number back, any cards you like. */
  griffGive(state, prompt, log) {
    const player = prompt.player;
    const theirs = state.players[opponentOf(player)].unitHand;
    const mine = state.players[player].unitHand;
    let given = 0;
    for (const uid of prompt.chosen) {
      const card = takeByUid(mine, uid);
      if (!card) continue;
      theirs.push(card);
      given += 1;
    }
    if (given > 0) log(`Griff visszaad ${given} egységlapot.`);
  },

  /**
   * Fuedrax, the first half: which spell goes down. The card leaves the hand
   * here, before the tile is named, because committing it is the price and the
   * tile is only where it waits.
   */
  /**
   * Szerencsejátékos, having seen the coin, deciding whether to throw it again.
   *
   * The re-flip is the same call the Belépő made, one flip further along, so
   * pressing on three times is three passes through one piece of code rather
   * than a loop that has to know when to stop. Stopping is simply not calling
   * it: the winnings are already on the unit, they were paid the moment the
   * coin came down.
   */
  coinFlip(state, prompt, log) {
    const data = prompt.data ?? {};
    const unitUid = String(data.unitUid ?? "");
    const unit = ALL_SLOTS.map((slot) => state.board[slot]).find((u) => u?.uid === unitUid);
    if (!unit) return;
    const won = Number(data.won ?? 0);
    if (prompt.chosen[0] !== "again") {
      log(`${cardOf(unit).name} beéri ${won} gyűrűvel.`);
      return;
    }
    flipCoin(
      state,
      unit,
      {
        amount: Number(data.amount ?? 1),
        won,
        flipsLeft: Math.max(0, Number(data.flipsLeft ?? 0) - 1),
      },
      log,
    );
  },

  trapSpell(state, prompt, log) {
    const player = prompt.player;
    const uid = prompt.chosen[0];
    if (!uid) return;
    const slots = trapSlots(state, player);
    if (slots.length === 0) {
      log("Fuedrax csapdájának nincs szabad ellenséges mező.");
      return;
    }
    const card = takeByUid(state.players[player].spellHand, uid);
    if (!card) return;
    askPrompt(state, {
      kind: "trapSlot",
      player,
      prompt: `${nameOf(card.cardId)}: melyik ellenséges mezőre`,
      picking: "slot",
      slots,
      min: 1,
      max: 1,
      sourceCardId: prompt.sourceCardId,
      data: { uid: card.uid, cardId: card.cardId, sourceUid: prompt.data?.sourceUid },
    });
  },

  /** Fuedrax, the second half: which tile it watches. */
  trapSlot(state, prompt, log) {
    const slot = prompt.chosen[0];
    const uid = String(prompt.data?.uid ?? "");
    const cardId = String(prompt.data?.cardId ?? "");
    if (!slot || !uid || !cardId) return;
    state.traps.push({
      id: ++state.uidCounter,
      owner: prompt.player,
      slot,
      uid,
      cardId,
      sourceUid: prompt.data?.sourceUid ? String(prompt.data.sourceUid) : undefined,
    });
    log(`Csapda ide: ${slotLabel(slot)}.`);
    recordReveal(state, {
      kind: "trap",
      player: prompt.player,
      cardIds: [cardId],
      slot,
      sourceCardId: prompt.sourceCardId,
    });
  },
};

// ---------------------------------------------------------------------------
// Traps
// ---------------------------------------------------------------------------

export function trapAt(state: GameState, slot: SlotId): Trap | null {
  return state.traps.find((t) => t.slot === slot) ?? null;
}

/**
 * Every trap whose tile has since been stepped on, sprung.
 *
 * Pull rather than push. A unit arrives on a tile from six different directions
 * — placement, a move, a swap, a summon, a revive, a transform — and hooking all
 * six would be six chances to forget one. Asking "is anybody standing on my
 * tile" once the dust has settled cannot miss an arrival whatever caused it,
 * which is the same reading the theatre does for the same reason.
 *
 * "Any unit, including friendly ones": the trap does not check whose the unit
 * is. That is the whole risk of setting one.
 */
export function springTraps(state: GameState, log: (text: string) => void): void {
  let guard = 0;
  while (guard++ < 12) {
    const index = state.traps.findIndex((t) => !!state.board[t.slot]);
    if (index === -1) return;
    const [trap] = state.traps.splice(index, 1);
    const victim = state.board[trap.slot];
    if (!victim) continue;
    fireTrap(state, trap, victim, log);
    sweepDead(state, log);
  }
}

/**
 * A trap has nobody nominating anything, so the two things the resolution
 * machine normally asks for are settled here instead: the target is whoever
 * stepped on the tile, and anything else the spell wants is rolled for off the
 * game seed.
 *
 * A spell that could never have named the unit that walked in goes off into
 * nothing. That is a real risk of the card rather than a failure of it — you
 * commit the spell before you know who is coming.
 */
function fireTrap(
  state: GameState,
  trap: Trap,
  victim: UnitInstance,
  log: (text: string) => void,
): void {
  const spell = trySpell(trap.cardId);
  state.players[trap.owner].discard.push({ uid: trap.uid, cardId: trap.cardId });
  if (!spell) return;

  const valid = trapValid(state, spell, victim, trap.owner);
  log(`${cardOf(victim).name} csapdába lép: ${spell.name}.`);
  // A trap springing is public: the spell resolves in the open like any other,
  // and the player who walked into it is owed an explanation for what just
  // happened to their unit. Only the setting of it was ever private.
  recordReveal(state, {
    kind: "trap",
    player: trap.owner,
    cardIds: [trap.cardId],
    subjectCardId: cardOf(victim).id,
    slot: trap.slot,
    verdict: valid ? "yes" : "no",
    open: true,
  });

  if (!valid) {
    log(`${spell.name} elszáll, ${cardOf(victim).name} nem érvényes cél.`);
    return;
  }

  // Fuedrax casts it if he is still standing. Otherwise the spell goes off with
  // nobody holding it, and whatever it wanted to do to its own caster simply
  // does not happen — the honest reading of a trap whose setter is dead.
  const source = trap.sourceUid
    ? (ALL_SLOTS.map((s) => state.board[s]).find((u) => u?.uid === trap.sourceUid) ?? null)
    : null;

  const ctx: EffectContext = {
    state,
    source,
    controller: trap.owner,
    spell,
    destination: randomDestination(state, victim),
    log,
  };
  for (const effect of spell.effects) {
    applyEffect(ctx, effect as Effect, [trap.slot]);
  }

  // The spell stays on whatever it hit, like every other spell that resolves
  // onto a unit, so hovering the tile shows it in the fan.
  const landed = state.board[trap.slot];
  if (landed && landed.uid === victim.uid) {
    landed.placed.push({ spellId: spell.id, owner: trap.owner, spent: true });
  }
}

/**
 * Could the spell have named this unit at all, range and sight aside?
 *
 * Sides are read from whoever set the trap, not from whoever walked into it: a
 * healing spell in the ground is still a spell you cast, so it wants one of
 * yours, and a strike wants one of theirs. Getting the wrong one is the fizzle
 * the card warns about.
 */
function trapValid(
  state: GameState,
  spell: SpellCard,
  victim: UnitInstance,
  owner: PlayerId,
): boolean {
  const spec = spell.target;
  // A spell that names no target picks its own set; there is nothing to check.
  if (!spec) return true;
  // A trap watches a tile, so a spell that wants an empty one has already lost.
  if (spec.emptyOnly) return false;
  if (spec.side === "ally" && victim.owner !== owner) return false;
  if (spec.side === "enemy" && victim.owner === owner) return false;
  // "self" means the caster, and the caster is never the one stepping in.
  if (spec.side === "self") return false;
  for (const tag of [...spell.schools, ...(spell.tags ?? [])]) {
    if (victim.immunities.includes(tag)) return false;
  }
  return matchesFilter(victim, spec.filter, state);
}

/** A destination for a spell that shifts something, rolled off the game seed. */
function randomDestination(state: GameState, victim: UnitInstance): SlotId | undefined {
  const open = legalDestinations(state, victim, "anyEmpty");
  if (open.length === 0) return undefined;
  const [index, seed] = randomInt(state.rng, open.length);
  state.rng = seed;
  return open[index];
}

function trySpell(id: string): SpellCard | undefined {
  try {
    return getSpell(id);
  } catch {
    return undefined;
  }
}

/**
 * A trap is a spell that was committed and never went off. 12.3 takes the cast
 * spells at leszerelés and this goes the same way, rather than waiting for a
 * battlefield that no longer exists.
 */
export function clearTraps(state: GameState): void {
  for (const trap of state.traps) {
    state.players[trap.owner].discard.push({ uid: trap.uid, cardId: trap.cardId });
  }
  state.traps = [];
}

// ---------------------------------------------------------------------------
// Felix's portal
// ---------------------------------------------------------------------------

/**
 * Where a unit that walked out of a lost battle stands in the next one.
 *
 * Its own tile, unless it ended the fight across the line — a unit pushed onto
 * the enemy half is still yours, but it cannot arrive on a tile it does not own,
 * so it takes the nearest of its own instead. Nearest is measured off the
 * mirrored coordinates, and ties break on the fixed slot order, so the same
 * board always produces the same arrival.
 */
export function portalArrival(state: GameState, portal: Portal): SlotId | null {
  const mine = slotsOf(portal.owner).filter(
    (slot) => !state.board[slot] && !isBlocked(state, slot),
  );
  if (mine.length === 0) return null;
  if (mine.includes(portal.slot)) return portal.slot;
  const home =
    ownerOfSlot(portal.slot) === portal.owner
      ? portal.slot
      : `${portal.owner}.${portal.slot.slice(3)}`;
  return mine
    .slice()
    .sort((a, b) => gap(a, home) - gap(b, home) || ALL_SLOTS.indexOf(a) - ALL_SLOTS.indexOf(b))[0];
}

function gap(a: SlotId, home: SlotId): number {
  const rowGap = a[3] === home[3] ? 0 : 1;
  return rowGap + Math.abs(Number(a[4]) - Number(home[4]));
}
