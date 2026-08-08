/**
 * validate_cards.ts — Validates data/cards.json for the Trigger/Target/Effect format.
 *
 * Checks:
 *   - Unique card_id values
 *   - Card ID ranges match card_type (1xxx=char, 2xxx=unit, 3xxx=spell)
 *   - Required fields present per card type
 *   - Ability structure: trigger, targets, effects present and valid
 *   - Trigger events, target types, effect step types use valid enum values
 *   - Flow control structures are well-formed
 *
 * Run from project root:
 *   npx ts-node --project tools/tsconfig.json tools/validate_cards.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const CARDS_JSON = path.join(ROOT, 'data', 'cards.json');

// Valid enum values matching GDScript resources
const TRIGGER_EVENTS = new Set([
  'ON_PLAY', 'CONTINUOUS', 'ON_TURN_START', 'ON_TURN_END', 'ON_DEATH', 'ON_EXILE',
  'ON_ATTACK', 'ON_ATTACK_KILL', 'ON_KILL', 'ON_DEFENSE', 'ON_TAKE_DAMAGE', 'ON_HEAL',
  'ON_MOVE', 'ON_COUNTER_CHANGE', 'ON_COUNTER_COUNT', 'ON_SPELL_ATTACHED',
  'ON_WEAPON_ATTACHED', 'ON_ENTERS_TILE', 'ACTIVATED', 'ON_DISCARDED', 'ON_DRAW',
  'ON_ADJACENCY', 'ON_TRANSFORM', 'ON_TIMER', 'ON_ABILITY',
]);

const TRIGGER_MOD1 = new Set(['SELF', 'ALLY', 'ENEMY', 'ANY']);
const TRIGGER_MOD2 = new Set(['None', 'Unit', 'Spell', 'Weapon', 'Trap', 'ForceOfNature', 'Character']);
const LIMIT_TYPES = new Set(['NONE', 'PER_TURN', 'PER_GAME']);

const TARGET_TYPES = new Set(['Unit', 'Player', 'Entity', 'Deck', 'Hand', 'Graveyard', 'Pile', 'Area', 'Card', 'SideDeck']);
const TARGET_OWNERS = new Set(['Ally', 'Enemy', 'Any']);
const TARGETING_MODES = new Set(['Automatic', 'PlayerChoice', 'OpponentChoice', 'Random', 'AllValid', 'Self']);

const EFFECT_STEPS = new Set([
  'Draw', 'Search', 'Reveal', 'Discard', 'MoveToZone', 'Kill', 'Exile',
  'DealDamage', 'Heal', 'ModifyStat', 'ModifyKeyword', 'ModifyCounter',
  'Summon', 'Move', 'Swap', 'MakeAttack', 'Attach', 'ExecuteAbility', 'AutoPlay',
  'PlayCard',
  '', // empty string for pure flow-control nodes
]);

const FLOW_TYPES = new Set(['none', 'conditional', 'repeat', 'repeat_while', 'for_each', 'choose_one']);

const CARD_CLASSES = new Set([
  'Harcos', 'Mágus', 'Vaják', 'Zsivány', 'Bölcs', 'Garabonciás', 'Csodatevő', 'Mítikus'
]);

const STEP_PARAMETERS: Record<string, string[]> = {
  Draw: ['DrawAmount', 'DrawFilters'],
  Search: ['ShownAmount', 'SelectAmount', 'SearchFilters', 'Prompt'],
  Reveal: ['CardOrder', 'RevealAmount'],
  Discard: ['DiscardAmount', 'DiscardFilters'],
  MoveToZone: ['GoalZone', 'GoalZoneOrder'],
  Kill: [],
  Exile: [],
  DealDamage: ['DamageAmount'],
  Heal: ['HealAmount'],
  ModifyStat: ['ModifiedStat', 'ModifyAmount', 'SetAmount', 'ModifyDuration', 'ModifyDurationTurns', 'ApplyFilter'],
  ModifyKeyword: ['AddedKeywords', 'RemovedKeywords', 'NewKeywordDurations', 'NewKeywordDurationTurns'],
  ModifyCounter: ['CounterType', 'ModifyAmount', 'SetAmount'],
  Summon: ['SummonedEntity', 'SummoningTile', 'SummonConstraint', 'SummonPrompt'],
  Move: ['MoveDirection', 'MoveAmount'],
  Swap: [],
  MakeAttack: ['AttackedEntity'],
  Attach: [],
  ExecuteAbility: ['AbilityType', 'AbilitySource', 'AbilityTarget'],
  AutoPlay: ['Targeting'],
  PlayCard: ['ExtraCost'],
};

const errors: string[] = [];
const warnings: string[] = [];

function err(msg: string) { errors.push(msg); }
function warn(msg: string) { warnings.push(msg); }

function validateTrigger(trigger: any, ctx: string) {
  if (!trigger || typeof trigger !== 'object') {
    err(`${ctx}: trigger must be an object`);
    return;
  }
  if (!trigger.event) err(`${ctx}: trigger missing event`);
  else if (!TRIGGER_EVENTS.has(trigger.event)) warn(`${ctx}: unknown trigger event "${trigger.event}"`);

  if (trigger.modifier1 && !TRIGGER_MOD1.has(trigger.modifier1))
    warn(`${ctx}: unknown trigger modifier1 "${trigger.modifier1}"`);
  if (trigger.modifier2 && !TRIGGER_MOD2.has(trigger.modifier2))
    warn(`${ctx}: unknown trigger modifier2 "${trigger.modifier2}"`);
  if (trigger.limit_type && !LIMIT_TYPES.has(trigger.limit_type))
    warn(`${ctx}: unknown limit_type "${trigger.limit_type}"`);

  if (trigger.trigger_interactors != null) {
    if (typeof trigger.trigger_interactors !== 'object' || Array.isArray(trigger.trigger_interactors)) {
      err(`${ctx}: trigger_interactors must be an object map`);
    } else {
      for (const [name, cond] of Object.entries(trigger.trigger_interactors)) {
        if (!name || typeof name !== 'string') {
          err(`${ctx}: trigger_interactors has invalid interactor name`);
          continue;
        }
        if (typeof cond !== 'string') {
          err(`${ctx}: trigger_interactors.${name} must be a string condition`);
        }
      }
    }
  }
}

function validateTarget(target: any, ctx: string) {
  if (!target || typeof target !== 'object') {
    err(`${ctx}: target must be an object`);
    return;
  }
  if (!target.target_type) err(`${ctx}: missing target_type`);
  else if (!TARGET_TYPES.has(target.target_type)) warn(`${ctx}: unknown target_type "${target.target_type}"`);

  if (!target.owner) err(`${ctx}: missing owner`);
  else if (!TARGET_OWNERS.has(target.owner)) warn(`${ctx}: unknown owner "${target.owner}"`);

  if (!target.targeting) err(`${ctx}: missing targeting`);
  else if (!TARGETING_MODES.has(target.targeting)) warn(`${ctx}: unknown targeting "${target.targeting}"`);
}

function validateEffect(effect: any, ctx: string) {
  if (!effect || typeof effect !== 'object') {
    err(`${ctx}: effect must be an object`);
    return;
  }

  if (effect.step == null) err(`${ctx}: missing step field`);
  else if (!EFFECT_STEPS.has(effect.step)) warn(`${ctx}: unknown step type "${effect.step}"`);

  if (effect.parameters != null) {
    if (typeof effect.parameters !== 'object' || Array.isArray(effect.parameters)) {
      err(`${ctx}: parameters must be an object`);
    } else {
      const allowed = new Set(STEP_PARAMETERS[effect.step] || []);
      const legacy = new Set(['DrawZone']);
      for (const key of Object.keys(effect.parameters)) {
        if (!allowed.has(key) && !legacy.has(key)) {
          warn(`${ctx}: unexpected parameter "${key}" for step "${effect.step}"`);
        }
      }
    }
  }

  // Validate inline_target if present
  if (effect.inline_target) {
    validateTarget(effect.inline_target, `${ctx} inline_target`);
  }

  // Validate flow
  if (effect.flow && typeof effect.flow === 'object' && Object.keys(effect.flow).length > 0) {
    if (!effect.flow.type) warn(`${ctx}: flow missing type`);
    else if (!FLOW_TYPES.has(effect.flow.type)) warn(`${ctx}: unknown flow type "${effect.flow.type}"`);

    if (effect.flow.type === 'choose_one') {
      if (!Array.isArray(effect.choices) || effect.choices.length === 0)
        err(`${ctx}: choose_one flow requires non-empty choices array`);
    }
    if (effect.flow.type === 'conditional' || effect.flow.type === 'repeat_while') {
      if (!effect.flow.condition) warn(`${ctx}: ${effect.flow.type} flow missing condition`);
    }
    if (effect.flow.type === 'repeat') {
      if (effect.flow.count == null) warn(`${ctx}: repeat flow missing count`);
    }
    if (effect.flow.type === 'for_each') {
      if (!effect.flow.source) warn(`${ctx}: for_each flow missing source`);
    }
  }

  // Validate sub_effects recursively
  if (Array.isArray(effect.sub_effects)) {
    for (let i = 0; i < effect.sub_effects.length; i++) {
      validateEffect(effect.sub_effects[i], `${ctx} sub[${i}]`);
    }
  }
  if (Array.isArray(effect.else_effects)) {
    for (let i = 0; i < effect.else_effects.length; i++) {
      validateEffect(effect.else_effects[i], `${ctx} else[${i}]`);
    }
  }
  if (Array.isArray(effect.choices)) {
    for (let ci = 0; ci < effect.choices.length; ci++) {
      const choice = effect.choices[ci];
      if (!choice.label) warn(`${ctx} choice[${ci}]: missing label`);
      if (!Array.isArray(choice.effects)) err(`${ctx} choice[${ci}]: effects must be an array`);
      else {
        for (let ei = 0; ei < choice.effects.length; ei++) {
          validateEffect(choice.effects[ei], `${ctx} choice[${ci}].eff[${ei}]`);
        }
      }
    }
  }
}

function validateAbility(ab: any, ctx: string) {
  if (!ab.ability_name) err(`${ctx}: missing ability_name`);

  // Trigger
  validateTrigger(ab.trigger, `${ctx} trigger`);

  // Targets
  if (!Array.isArray(ab.targets)) {
    err(`${ctx}: targets must be an array`);
  } else {
    for (let i = 0; i < ab.targets.length; i++) {
      validateTarget(ab.targets[i], `${ctx} target[${i}]`);
    }
  }

  // Effects
  if (!Array.isArray(ab.effects)) {
    err(`${ctx}: effects must be an array`);
  } else {
    for (let i = 0; i < ab.effects.length; i++) {
      validateEffect(ab.effects[i], `${ctx} effect[${i}]`);
    }
  }
}

function main() {
  console.log('=== Card Validator (Trigger/Target/Effect) ===\n');

  let cards: any[];
  try {
    cards = JSON.parse(fs.readFileSync(CARDS_JSON, 'utf-8'));
  } catch (e: any) {
    console.error('Failed to parse cards.json:', e.message);
    process.exit(1);
  }

  console.log(`Validating ${cards.length} cards...\n`);

  // Check unique IDs
  const ids = new Set<number>();
  for (const c of cards) {
    if (ids.has(c.card_id)) err(`Duplicate card_id: ${c.card_id}`);
    ids.add(c.card_id);
  }

  for (const c of cards) {
    const ctx = `[${c.card_id}] ${c.card_name}`;

    // Required fields
    if (!c.card_id) err(`${ctx}: missing card_id`);
    if (!c.card_name) err(`${ctx}: missing card_name`);
    if (!c.card_type) err(`${ctx}: missing card_type`);
    if (!c.card_class) err(`${ctx}: missing card_class`);
    else if (!CARD_CLASSES.has(c.card_class)) warn(`${ctx}: unknown card_class "${c.card_class}"`);
    if (c.card_class2 && !CARD_CLASSES.has(c.card_class2)) warn(`${ctx}: unknown card_class2 "${c.card_class2}"`);
    if (c.description == null) err(`${ctx}: missing description`);

    // ID range check
    if (c.card_type === 'character' && (c.card_id < 1000 || c.card_id >= 2000))
      warn(`${ctx}: character card_id should be 1xxx`);
    if (c.card_type === 'unit' && (c.card_id < 2000 || c.card_id >= 3000))
      warn(`${ctx}: unit card_id should be 2xxx`);
    if (c.card_type === 'spell' && (c.card_id < 3000 || c.card_id >= 4000))
      warn(`${ctx}: spell card_id should be 3xxx`);

    // Type-specific
    if (c.card_type === 'unit') {
      if (c.attack == null) warn(`${ctx}: unit missing attack`);
    }
    if (c.card_type === 'character') {
      if (!c.title) warn(`${ctx}: character missing title`);
      if (c.cost != null) warn(`${ctx}: character should not define cost`);
      if (c.rarity != null) warn(`${ctx}: character should not define rarity`);
      if (c.health != null) warn(`${ctx}: character should not define health`);
    }

    // Abilities
    if (!Array.isArray(c.abilities)) {
      err(`${ctx}: abilities must be an array`);
    } else {
      for (let i = 0; i < c.abilities.length; i++) {
        validateAbility(c.abilities[i], `${ctx} ability[${i}]`);
      }
    }
  }

  // Report
  if (errors.length === 0 && warnings.length === 0) {
    console.log('All cards valid! No errors or warnings.');
  }
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    warnings.forEach(w => console.log(`  WARN: ${w}`));
  }
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach(e => console.log(`  ERROR: ${e}`));
    process.exit(1);
  }

  console.log(`\n${cards.length} cards validated successfully.`);
}

main();
