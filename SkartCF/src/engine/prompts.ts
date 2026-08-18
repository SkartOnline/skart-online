import type { GameState, Prompt, Reveal } from "./types";

/**
 * The queue an ability parks itself in when it needs the player to decide
 * something.
 *
 * Two other things already answer most questions. An ability that resolves on
 * its own picks its target off `AutoTargetSpec.pick`, and the resolution machine
 * in `resolve.ts` collects a spell's caster, target and destination — but only
 * ever as tiles. Anything neither can express belongs here: a card out of a pile
 * nobody is looking at, several cards at once, a card and then a tile. Push a
 * `Prompt` and stop; nothing in the game may happen until it is answered.
 *
 * A prompt is data, and its completion is a handler keyed by `kind`, exactly
 * like an effect. That is not tidiness: a closure would not survive the
 * `structuredClone` every action does, and the bot evaluates a move by cloning
 * the position it leads to, so a prompt holding a function would break the
 * opponent rather than the rules.
 *
 * The answer arrives as an ordinary action, which is what lets the bot and the
 * simulator play these cards without knowing any of this exists. A new asking
 * ability is a prompt `kind` and a completion handler; nothing else in the
 * engine has to know it exists.
 *
 * This file holds the queue and nothing else, and imports nothing but the
 * types, so the effect table can push onto it without importing the handlers
 * that read it. Those live in `interactions.ts`.
 */

export function pendingPrompt(state: GameState): Prompt | null {
  return state.prompts[0] ?? null;
}

/** The picks still on offer: whatever has not been chosen yet. */
export function promptOptions(prompt: Prompt): string[] {
  const taken = new Set(prompt.chosen);
  if (prompt.picking === "card") {
    return (prompt.cards ?? []).map((c) => c.uid).filter((uid) => !taken.has(uid));
  }
  return (prompt.slots ?? []).filter((slot) => !taken.has(slot));
}

/** May this prompt be closed where it stands? */
export function promptSatisfied(prompt: Prompt): boolean {
  return prompt.chosen.length >= prompt.min;
}

export function askPrompt(state: GameState, prompt: Omit<Prompt, "id" | "chosen">): void {
  state.prompts.push({ ...prompt, id: ++state.promptCounter, chosen: [] });
}

/**
 * Something a player is entitled to have seen. The engine has nowhere else to
 * put information — a chronicle line is a sentence, not a card held up — so it
 * records what was shown and who may look, and the theatre prints it for one
 * beat.
 */
export function recordReveal(state: GameState, reveal: Omit<Reveal, "id">): void {
  state.reveals.push({ ...reveal, id: ++state.revealCounter });
}

/** For the theatre: what has been shown since the previous state. */
export function newReveals(before: GameState, after: GameState): Reveal[] {
  return after.reveals.slice(before.reveals.length);
}
