/**
 * generate_cards.ts — Single-source card pipeline generator.
 *
 * Reads data/cards.json (the canonical card database) and generates:
 *   1. data/cards/*.tres   — Godot resource files
 *   2. scripts/cards/card_database.gd — preload map + fallback builders
 *   3. server/src/cards.ts — server card catalog
 *
 * Uses the Trigger / Target / Effect 3-phase ability architecture.
 *
 * Run from project root:
 *   npx ts-node --project tools/tsconfig.json tools/generate_cards.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// TYPES — mirrors the GDScript resources (trigger.gd, target.gd, effect_step.gd)
// ---------------------------------------------------------------------------

interface TriggerDef {
  event: string;
  modifier1?: string;       // default "SELF"
  modifier2?: string;       // default "None"
  parameters?: Record<string, any>;
  game_state_condition?: string;
  trigger_interactors?: Record<string, string>;
  limit_type?: string;      // default "NONE"
  limit_count?: number;     // default 0
}

interface TargetDef {
  target_type: string;
  owner: string;
  condition?: string;
  range?: number | string;  // default 0, can be dynamic ref e.g. "targets[0].attack_range"
  count?: number;           // default 1
  targeting: string;
  prompt?: string;
  trigger_interactor?: string; // e.g. "PlayedCard" — always Card + Automatic
}

interface EffectStepDef {
  step: string;             // empty string "" for pure flow-control nodes
  parameters?: Record<string, any>;
  tag?: string;
  target_ref?: string;
  inline_target?: TargetDef;
  flow?: Record<string, any>;
  sub_effects?: EffectStepDef[];
  else_effects?: EffectStepDef[];
  choices?: ChoiceDef[];
}

interface ChoiceDef {
  label: string;
  effects: EffectStepDef[];
}

interface AbilityDef {
  ability_name: string;
  description: string;
  trigger: TriggerDef;
  targets: TargetDef[];
  effects: EffectStepDef[];
}

interface CardDef {
  card_id: number;
  card_name: string;
  file_slug?: string;
  card_type: 'character' | 'unit' | 'spell' | 'weapon' | 'trap' | 'nature_force' | 'inspiration' | 'artifact' | 'quest' | 'building';
  collectible?: boolean;
  card_class: string;
  card_class2?: string;
  cost?: number;
  title?: string;
  attack?: number;
  hp?: number;
  move_speed?: number;
  attack_range?: number;
  spell_type?: string;
  spell_range?: number;
  school?: string;
  description: string;
  abilities: AbilityDef[];
  tags?: string[];
  flavor_text?: string;
  rarity?: number;
  art_path?: string;
  deckbuilding_rules?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const CARDS_JSON = path.join(ROOT, 'data', 'cards.json');
const TRES_DIR = path.join(ROOT, 'data', 'cards');
const CARD_DB_PATH = path.join(ROOT, 'scripts', 'cards', 'card_database.gd');
const CARDS_TS_PATH = path.join(ROOT, 'server', 'src', 'cards.ts');

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------

const cards: CardDef[] = JSON.parse(fs.readFileSync(CARDS_JSON, 'utf-8'));
cards.sort((a, b) => a.card_id - b.card_id);
console.log(`Loaded ${cards.length} cards from cards.json`);

const CARD_CLASSES = new Set([
  'Harcos', 'Mágus', 'Vaják', 'Zsivány', 'Bölcs', 'Garabonciás', 'Csodatevő', 'Mítikus',
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
  ModifyCounter: ['CounterType', 'ModifyAmount', 'SetAmount', 'MaxCount'],
  Summon: ['SummonedEntity', 'SummoningTile', 'SummonConstraint', 'SummonPrompt'],
  Move: ['MoveDirection', 'MoveAmount'],
  Swap: [],
  MakeAttack: ['AttackedEntity'],
  Attach: [],
  ExecuteAbility: ['AbilityType', 'AbilitySource', 'AbilityTarget'],
  AutoPlay: ['Targeting'],
  PlayCard: ['ExtraCost'],
};

const UNIT_LIKE_TYPES = new Set<string>(['unit', 'building']);

const GD_CARD_TYPE_BY_JSON: Record<string, string> = {
  character: 'Card.CardType.CHARACTER',
  unit: 'Card.CardType.UNIT',
  spell: 'Card.CardType.SPELL',
  weapon: 'Card.CardType.WEAPON',
  trap: 'Card.CardType.TRAP',
  nature_force: 'Card.CardType.NATURE_FORCE',
  inspiration: 'Card.CardType.INSPIRATION',
  artifact: 'Card.CardType.ARTIFACT',
  quest: 'Card.CardType.QUEST',
  building: 'Card.CardType.BUILDING',
};

const LEGACY_PARAMS = new Set(['DrawZone']);

function sanitizeEffect(effect: EffectStepDef): void {
  if (!effect || typeof effect !== 'object') return;
  const allowed = new Set(STEP_PARAMETERS[effect.step] || []);
  if (effect.parameters && typeof effect.parameters === 'object') {
    const next: Record<string, any> = {};
    for (const [k, v] of Object.entries(effect.parameters)) {
      if (allowed.has(k) || LEGACY_PARAMS.has(k)) next[k] = v;
    }
    effect.parameters = next;
  }
  effect.sub_effects?.forEach(sanitizeEffect);
  effect.else_effects?.forEach(sanitizeEffect);
  effect.choices?.forEach(ch => ch.effects?.forEach(sanitizeEffect));
}

function sanitizeCard(card: CardDef): void {
  if (!CARD_CLASSES.has(card.card_class)) {
    throw new Error(`Invalid card_class "${card.card_class}" on card ${card.card_id} (${card.card_name})`);
  }
  if (card.card_class2 && !CARD_CLASSES.has(card.card_class2)) {
    throw new Error(`Invalid card_class2 "${card.card_class2}" on card ${card.card_id} (${card.card_name})`);
  }
  if (card.card_type === 'character') {
    delete (card as any).cost;
    delete (card as any).rarity;
    delete (card as any).health;
  }
  card.abilities?.forEach(ab => ab.effects?.forEach(sanitizeEffect));
}

cards.forEach(sanitizeCard);

// ---------------------------------------------------------------------------
// GODOT UIDS — preserve existing uids for stable references
// ---------------------------------------------------------------------------

const SCRIPT_UIDS: Record<string, string> = {
  'character_card.gd': 'uid://cmoe2lyoum0oe',
  'unit_card.gd': 'uid://bf711n1425ndf',
  'spell_card.gd': 'uid://bo6m1vdd0m4vq',
  'ability.gd': 'uid://8pkq1chvkr5a',
  // New scripts — UIDs will be assigned by Godot on first project scan.
  // Leave empty to use path-only ext_resource references.
  'trigger.gd': '',
  'target.gd': '',
  'effect_step.gd': '',
};

// Try to read UIDs from .uid files for new scripts
for (const script of ['trigger.gd', 'target.gd', 'effect_step.gd']) {
  const uidPath = path.join(ROOT, 'scripts', 'abilities', `${script}.uid`);
  if (fs.existsSync(uidPath)) {
    const content = fs.readFileSync(uidPath, 'utf-8').trim();
    if (content.startsWith('uid://')) {
      SCRIPT_UIDS[script] = content;
    }
  }
}

const RESOURCE_UIDS: Record<number, string> = {
  1001: 'uid://df5he80vmch3e',
  1002: 'uid://c2kmgox5oa88b',
  2001: 'uid://dtcues7iuqrd0',
  2002: 'uid://dswqsh3cb0fa',
  3001: 'uid://c2rglt77dg0bi',
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const ACCENT_MAP: Record<string, string> = {
  '\u00e1': 'a', '\u00e9': 'e', '\u00ed': 'i', '\u00f3': 'o',
  '\u00f6': 'o', '\u0151': 'o', '\u00fa': 'u', '\u00fc': 'u', '\u0171': 'u',
};

function slugify(name: string): string {
  let s = name.toLowerCase();
  for (const [from, to] of Object.entries(ACCENT_MAP)) {
    s = s.split(from).join(to);
  }
  return s.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function getSlug(card: CardDef): string {
  return card.file_slug || slugify(card.card_name);
}

function getCardCost(card: CardDef): number {
  return card.cost ?? 0;
}

const SPELL_TYPE_MAP: Record<string, number> = {
  'Azonnali': 0, 'R\u00edtus': 1, 'Reakci\u00f3': 2, 'Permanens': 3,
};

const SPELL_TYPE_GD_MAP: Record<string, string> = {
  'Azonnali': 'SpellCardScript.SpellType.INSTANT',
  'R\u00edtus': 'SpellCardScript.SpellType.RITUAL',
  'Reakci\u00f3': 'SpellCardScript.SpellType.REACTION',
  'Permanens': 'SpellCardScript.SpellType.PERMANENT',
};

const RARITY_GD_MAP: Record<number, string> = {
  0: 'Card.Rarity.COMMON', 1: 'Card.Rarity.UNCOMMON',
  2: 'Card.Rarity.RARE', 3: 'Card.Rarity.LEGENDARY', 4: 'Card.Rarity.MYTHIC',
};

function escGd(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escTs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Build a Godot ext_resource line with optional UID. */
function extResourceLine(script: string, scriptPath: string, id: string): string {
  const uid = SCRIPT_UIDS[script];
  if (uid) {
    return `[ext_resource type="Script" uid="${uid}" path="${scriptPath}" id="${id}"]`;
  }
  return `[ext_resource type="Script" path="${scriptPath}" id="${id}"]`;
}

/** Serialize a value for .tres format. */
function serializeGdValue(val: any): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return `"${escGd(val)}"`;
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    return `[${val.map(v => serializeGdValue(v)).join(', ')}]`;
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val).map(([k, v]) => `"${escGd(k)}": ${serializeGdValue(v)}`);
    return `{${entries.join(', ')}}`;
  }
  return String(val);
}

// ---------------------------------------------------------------------------
// 1. GENERATE .tres FILES
// ---------------------------------------------------------------------------

// ext_resource IDs used in .tres generation
const EXT_IDS = {
  CARD_SCRIPT: '1_card',
  ABILITY: '2_abil',
  TRIGGER: '3_trig',
  TARGET: '4_tgt',
  EFFECT_STEP: '5_eff',
};

function generateTres(card: CardDef): string {
  const isCharLike = card.card_type === 'character';
  const isUnitLike = UNIT_LIKE_TYPES.has(card.card_type);
  const scriptClass = isCharLike ? 'CharacterCard'
    : isUnitLike ? 'UnitCard' : 'SpellCard';

  const scriptPath = isCharLike
    ? 'res://scripts/cards/character_card.gd'
    : isUnitLike
      ? 'res://scripts/cards/unit_card.gd'
      : 'res://scripts/cards/spell_card.gd';

  const scriptKey = isCharLike ? 'character_card.gd'
    : isUnitLike ? 'unit_card.gd' : 'spell_card.gd';

  const resUid = RESOURCE_UIDS[card.card_id];
  const lines: string[] = [];

  // Header
  if (resUid) {
    lines.push(`[gd_resource type="Resource" script_class="${scriptClass}" format=3 uid="${resUid}"]`);
  } else {
    lines.push(`[gd_resource type="Resource" script_class="${scriptClass}" format=3]`);
  }
  lines.push('');

  // ext_resource declarations
  lines.push(extResourceLine(scriptKey, scriptPath, EXT_IDS.CARD_SCRIPT));

  const hasAbilities = card.abilities && card.abilities.length > 0;
  const hasTargets = hasAbilities && card.abilities.some(ab => ab.targets.length > 0 || ab.effects.some(hasInlineTargets));
  const hasEffects = hasAbilities && card.abilities.some(ab => ab.effects.length > 0);

  if (hasAbilities) {
    lines.push(extResourceLine('ability.gd', 'res://scripts/abilities/ability.gd', EXT_IDS.ABILITY));
    lines.push(extResourceLine('trigger.gd', 'res://scripts/abilities/trigger.gd', EXT_IDS.TRIGGER));
  }
  if (hasTargets) {
    lines.push(extResourceLine('target.gd', 'res://scripts/abilities/target.gd', EXT_IDS.TARGET));
  }
  if (hasEffects) {
    lines.push(extResourceLine('effect_step.gd', 'res://scripts/abilities/effect_step.gd', EXT_IDS.EFFECT_STEP));
  }

  // Emit sub_resources for each ability
  const abilitySubResIds: string[] = [];
  if (hasAbilities) {
    for (let i = 0; i < card.abilities.length; i++) {
      const ab = card.abilities[i];
      const abilId = emitAbilitySubResources(ab, `ab${i}`, lines);
      abilitySubResIds.push(abilId);
    }
  }

  // Main resource
  lines.push('');
  lines.push('[resource]');
  lines.push(`script = ExtResource("${EXT_IDS.CARD_SCRIPT}")`);

  // Type-specific fields
  if (card.card_type === 'character') {
    if (card.title) lines.push(`title = "${escGd(card.title)}"`);
    if (card.deckbuilding_rules && Object.keys(card.deckbuilding_rules).length > 0) {
      lines.push(`deckbuilding_rules = ${serializeGdValue(card.deckbuilding_rules)}`);
    }
  } else if (isUnitLike) {
    lines.push(`attack = ${card.attack ?? 0}`);
    if ((card.hp ?? 1) !== 1) lines.push(`hp = ${card.hp}`);
    const default_move_speed = card.card_type === 'unit' ? 1 : 0;
    const default_attack_range = card.card_type === 'unit' ? 1 : 0;
    if ((card.move_speed ?? default_move_speed) !== default_move_speed) lines.push(`move_speed = ${card.move_speed}`);
    if ((card.attack_range ?? default_attack_range) !== default_attack_range) lines.push(`attack_range = ${card.attack_range}`);
  } else if (card.card_type === 'spell') {
    const st = SPELL_TYPE_MAP[card.spell_type ?? 'Azonnali'] ?? 0;
    if (st !== 0) lines.push(`spell_type = ${st}`);
    if (card.spell_range != null) lines.push(`spell_range = ${card.spell_range}`);
    if (card.school) lines.push(`school = "${escGd(card.school)}"`);
  }

  const gdCardType = GD_CARD_TYPE_BY_JSON[card.card_type];
  if (gdCardType && card.card_type !== 'character') {
    lines.push(`card_type = ${gdCardType}`);
  }

  // Common fields
  lines.push(`card_id = ${card.card_id}`);
  lines.push(`card_name = "${escGd(card.card_name)}"`);
  lines.push(`description = "${escGd(card.description)}"`);
  lines.push(`card_class = "${escGd(card.card_class)}"`);
  if (card.card_class2) lines.push(`card_class2 = "${escGd(card.card_class2)}"`);
  if (card.card_type !== 'character') {
    lines.push(`cost = ${getCardCost(card)}`);
    if (card.rarity && card.rarity > 0) lines.push(`rarity = ${card.rarity}`);
  }
  if (card.tags && card.tags.length > 0) {
    lines.push(`tags = [${card.tags.map(t => `"${escGd(t)}"`).join(', ')}]`);
  }
  if (card.flavor_text) lines.push(`flavor_text = "${escGd(card.flavor_text)}"`);
  if (card.art_path) lines.push(`art_path = "${escGd(card.art_path)}"`);
  if (abilitySubResIds.length > 0) {
    lines.push(`abilities = [${abilitySubResIds.map(id => `SubResource("${id}")`).join(', ')}]`);
  }

  lines.push('');
  return lines.join('\n');
}

function hasInlineTargets(effect: EffectStepDef): boolean {
  if (effect.inline_target) return true;
  if (effect.sub_effects?.some(hasInlineTargets)) return true;
  if (effect.else_effects?.some(hasInlineTargets)) return true;
  if (effect.choices?.some(c => c.effects.some(hasInlineTargets))) return true;
  return false;
}

/** Emit an AbilityTrigger sub_resource. */
function emitTriggerSubResource(trigger: TriggerDef, prefix: string, lines: string[]): string {
  const id = `Resource_${prefix}`;
  lines.push('');
  lines.push(`[sub_resource type="Resource" id="${id}"]`);
  lines.push(`script = ExtResource("${EXT_IDS.TRIGGER}")`);
  lines.push(`event = "${trigger.event}"`);
  if (trigger.modifier1 && trigger.modifier1 !== 'SELF') lines.push(`modifier1 = "${trigger.modifier1}"`);
  if (trigger.modifier2 && trigger.modifier2 !== 'None') lines.push(`modifier2 = "${trigger.modifier2}"`);
  if (trigger.parameters && Object.keys(trigger.parameters).length > 0) {
    lines.push(`parameters = ${serializeGdValue(trigger.parameters)}`);
  }
  if (trigger.game_state_condition) lines.push(`game_state_condition = "${escGd(trigger.game_state_condition)}"`);
  if (trigger.trigger_interactors && Object.keys(trigger.trigger_interactors).length > 0) {
    lines.push(`trigger_interactors = ${serializeGdValue(trigger.trigger_interactors)}`);
  }
  if (trigger.limit_type && trigger.limit_type !== 'NONE') lines.push(`limit_type = "${trigger.limit_type}"`);
  if (trigger.limit_count && trigger.limit_count > 0) lines.push(`limit_count = ${trigger.limit_count}`);
  return id;
}

/** Emit an AbilityTarget sub_resource. */
function emitTargetSubResource(target: TargetDef, prefix: string, lines: string[]): string {
  const id = `Resource_${prefix}`;
  lines.push('');
  lines.push(`[sub_resource type="Resource" id="${id}"]`);
  lines.push(`script = ExtResource("${EXT_IDS.TARGET}")`);
  lines.push(`target_type = "${target.target_type}"`);
  lines.push(`owner = "${target.owner}"`);
  if (target.condition) lines.push(`condition = "${escGd(target.condition)}"`);
  if (target.range && target.range !== 0) {
    if (typeof target.range === 'string') {
      lines.push(`target_range_expr = "${escGd(target.range)}"`);
    } else {
      lines.push(`target_range = ${target.range}`);
    }
  }
  if (target.count && target.count !== 1) lines.push(`count = ${target.count}`);
  lines.push(`targeting = "${target.targeting}"`);
  if (target.prompt) lines.push(`prompt = "${escGd(target.prompt)}"`);
  if (target.trigger_interactor) lines.push(`trigger_interactor = "${escGd(target.trigger_interactor)}"`);
  return id;
}

/** Recursively emit an EffectStep sub_resource and its children. Returns the sub_resource ID. */
function emitEffectSubResource(effect: EffectStepDef, prefix: string, lines: string[]): string {
  // Depth-first: emit children first

  // inline_target
  let inlineTargetId: string | null = null;
  if (effect.inline_target) {
    inlineTargetId = emitTargetSubResource(effect.inline_target, `${prefix}_itgt`, lines);
  }

  // sub_effects
  const subEffectIds: string[] = [];
  if (effect.sub_effects && effect.sub_effects.length > 0) {
    for (let i = 0; i < effect.sub_effects.length; i++) {
      subEffectIds.push(emitEffectSubResource(effect.sub_effects[i], `${prefix}_sub${i}`, lines));
    }
  }

  // else_effects
  const elseEffectIds: string[] = [];
  if (effect.else_effects && effect.else_effects.length > 0) {
    for (let i = 0; i < effect.else_effects.length; i++) {
      elseEffectIds.push(emitEffectSubResource(effect.else_effects[i], `${prefix}_else${i}`, lines));
    }
  }

  // choices
  const choiceData: { label: string; effectIds: string[] }[] = [];
  if (effect.choices && effect.choices.length > 0) {
    for (let ci = 0; ci < effect.choices.length; ci++) {
      const choice = effect.choices[ci];
      const ids: string[] = [];
      for (let si = 0; si < choice.effects.length; si++) {
        ids.push(emitEffectSubResource(choice.effects[si], `${prefix}_ch${ci}_e${si}`, lines));
      }
      choiceData.push({ label: choice.label, effectIds: ids });
    }
  }

  // Emit this effect step
  const id = `Resource_${prefix}`;
  lines.push('');
  lines.push(`[sub_resource type="Resource" id="${id}"]`);
  lines.push(`script = ExtResource("${EXT_IDS.EFFECT_STEP}")`);
  lines.push(`step = "${effect.step || ''}"`);

  if (effect.parameters && Object.keys(effect.parameters).length > 0) {
    lines.push(`parameters = ${serializeGdValue(effect.parameters)}`);
  }
  if (effect.tag) lines.push(`tag = "${escGd(effect.tag)}"`);
  if (effect.target_ref) lines.push(`target_ref = "${escGd(effect.target_ref)}"`);
  if (inlineTargetId) lines.push(`inline_target = SubResource("${inlineTargetId}")`);
  if (effect.flow && Object.keys(effect.flow).length > 0) {
    lines.push(`flow = ${serializeGdValue(effect.flow)}`);
  }
  if (subEffectIds.length > 0) {
    lines.push(`sub_effects = [${subEffectIds.map(sid => `SubResource("${sid}")`).join(', ')}]`);
  }
  if (elseEffectIds.length > 0) {
    lines.push(`else_effects = [${elseEffectIds.map(sid => `SubResource("${sid}")`).join(', ')}]`);
  }
  if (choiceData.length > 0) {
    const entries = choiceData.map(c => {
      const effsStr = c.effectIds.map(eid => `SubResource("${eid}")`).join(', ');
      return `{"label": "${escGd(c.label)}", "effects": [${effsStr}]}`;
    });
    lines.push(`choices = [${entries.join(', ')}]`);
  }

  return id;
}

/** Emit all sub_resources for one ability. Returns the ability sub_resource ID. */
function emitAbilitySubResources(ab: AbilityDef, prefix: string, lines: string[]): string {
  // Trigger
  const triggerId = emitTriggerSubResource(ab.trigger, `${prefix}_trig`, lines);

  // Targets
  const targetIds: string[] = [];
  for (let i = 0; i < ab.targets.length; i++) {
    targetIds.push(emitTargetSubResource(ab.targets[i], `${prefix}_tgt${i}`, lines));
  }

  // Effects
  const effectIds: string[] = [];
  for (let i = 0; i < ab.effects.length; i++) {
    effectIds.push(emitEffectSubResource(ab.effects[i], `${prefix}_eff${i}`, lines));
  }

  // Main ability sub_resource
  const mainId = `Resource_${prefix}`;
  lines.push('');
  lines.push(`[sub_resource type="Resource" id="${mainId}"]`);
  lines.push(`script = ExtResource("${EXT_IDS.ABILITY}")`);
  lines.push(`ability_name = "${escGd(ab.ability_name)}"`);
  lines.push(`description = "${escGd(ab.description)}"`);
  lines.push(`trigger = SubResource("${triggerId}")`);
  if (targetIds.length > 0) {
    lines.push(`targets = [${targetIds.map(id => `SubResource("${id}")`).join(', ')}]`);
  }
  if (effectIds.length > 0) {
    lines.push(`effects = [${effectIds.map(id => `SubResource("${id}")`).join(', ')}]`);
  }

  return mainId;
}

// ---------------------------------------------------------------------------
// 2. GENERATE card_database.gd
// ---------------------------------------------------------------------------

function generateCardDatabase(): string {
  const lines: string[] = [];
  lines.push('## AUTO-GENERATED by tools/generate_cards.ts — DO NOT EDIT MANUALLY');
  lines.push('## Source of truth: data/cards.json');
  lines.push('## CardDatabase — loads card definitions from .tres resource files.');
  lines.push('class_name CardDatabase');
  lines.push('extends RefCounted');
  lines.push('');
  lines.push('const CARDS_DIR := "res://data/cards/"');
  lines.push('const AbilityScript = preload("res://scripts/abilities/ability.gd")');
  lines.push('const AbilityTriggerScript = preload("res://scripts/abilities/trigger.gd")');
  lines.push('const AbilityTargetScript = preload("res://scripts/abilities/target.gd")');
  lines.push('const EffectStepScript = preload("res://scripts/abilities/effect_step.gd")');
  lines.push('const CharacterCardScript = preload("res://scripts/cards/character_card.gd")');
  lines.push('const UnitCardScript = preload("res://scripts/cards/unit_card.gd")');
  lines.push('const SpellCardScript = preload("res://scripts/cards/spell_card.gd")');
  lines.push('');

  // BUILTIN_CARDS preloads
  lines.push('const BUILTIN_CARDS := [');
  for (const card of cards) {
    const slug = getSlug(card);
    lines.push(`\tpreload("res://data/cards/${slug}.tres"),`);
  }
  lines.push(']');
  lines.push('');

  lines.push('static var _cards: Dictionary = {}');
  lines.push('static var _initialized: bool = false');
  lines.push('');
  lines.push('static func init() -> void:');
  lines.push('\tif _initialized:');
  lines.push('\t\treturn');
  lines.push('\t_initialized = true');
  lines.push('\t_load_cards()');
  lines.push('');
  lines.push('static func get_card(id: int):');
  lines.push('\tinit()');
  lines.push('\tif _cards.has(id):');
  lines.push('\t\treturn _cards[id].duplicate()');
  lines.push('\treturn null');
  lines.push('');
  lines.push('static func get_all_cards() -> Array:');
  lines.push('\tinit()');
  lines.push('\treturn _cards.values().duplicate()');
  lines.push('');

  lines.push('static func _load_cards() -> void:');
  lines.push('\t_cards.clear()');
  lines.push('\tfor card in BUILTIN_CARDS:');
  lines.push('\t\tif card and card.get("card_id"):');
  lines.push('\t\t\t_cards[card.card_id] = card');
  lines.push('\tvar dir := DirAccess.open(CARDS_DIR)');
  lines.push('\tif not dir:');
  lines.push('\t\tpush_warning("CardDatabase: Cannot open %s, using preloaded cards only." % CARDS_DIR)');
  lines.push('\t\tprint("CardDatabase: Loaded %d cards (preloaded only)." % _cards.size())');
  lines.push('\t\treturn');
  lines.push('\tdir.list_dir_begin()');
  lines.push('\tvar file_name := dir.get_next()');
  lines.push('\twhile file_name != "":');
  lines.push('\t\tif not dir.current_is_dir() and file_name.ends_with(".tres"):');
  lines.push('\t\t\tvar p := CARDS_DIR + file_name');
  lines.push('\t\t\tvar card = load(p)');
  lines.push('\t\t\tif card and card.get("card_id"):');
  lines.push('\t\t\t\t_cards[card.card_id] = card');
  lines.push('\t\t\telse:');
  lines.push('\t\t\t\tpush_warning("CardDatabase: Skipped %s (no card_id)" % p)');
  lines.push('\t\tfile_name = dir.get_next()');
  lines.push('\tdir.list_dir_end()');
  lines.push('\t_ensure_fallback_cards()');
  lines.push('\tprint("CardDatabase: Loaded %d cards." % _cards.size())');
  lines.push('');

  // Helper: _new_trigger
  lines.push('static func _new_trigger(event: String, params: Dictionary = {}) -> AbilityTriggerScript:');
  lines.push('\tvar t = AbilityTriggerScript.new()');
  lines.push('\tt.event = event');
  lines.push('\tfor key in params:');
  lines.push('\t\tt.set(key, params[key])');
  lines.push('\treturn t');
  lines.push('');

  // Helper: _new_target
  lines.push('static func _new_target(target_type: String, owner: String, targeting: String, params: Dictionary = {}) -> AbilityTargetScript:');
  lines.push('\tvar tgt = AbilityTargetScript.new()');
  lines.push('\ttgt.target_type = target_type');
  lines.push('\ttgt.owner = owner');
  lines.push('\ttgt.targeting = targeting');
  lines.push('\tfor key in params:');
  lines.push('\t\ttgt.set(key, params[key])');
  lines.push('\treturn tgt');
  lines.push('');

  // Helper: _new_effect
  lines.push('static func _new_effect(step: String, params: Dictionary = {}) -> EffectStepScript:');
  lines.push('\tvar e = EffectStepScript.new()');
  lines.push('\te.step = step');
  lines.push('\tfor key in params:');
  lines.push('\t\tif key == "parameters":');
  lines.push('\t\t\te.parameters = params[key]');
  lines.push('\t\telif key == "sub_effects" or key == "else_effects" or key == "choices":');
  lines.push('\t\t\tcontinue');
  lines.push('\t\telse:');
  lines.push('\t\t\te.set(key, params[key])');
  lines.push('\treturn e');
  lines.push('');

  // Helper: _new_ability
  lines.push('static func _new_ability(ability_name: String, description: String, trigger: AbilityTriggerScript, targets: Array = [], effects: Array = []) -> AbilityScript:');
  lines.push('\tvar ab = AbilityScript.new()');
  lines.push('\tab.ability_name = ability_name');
  lines.push('\tab.description = description');
  lines.push('\tab.trigger = trigger');
  lines.push('\tab.targets = targets');
  lines.push('\tab.effects = effects');
  lines.push('\treturn ab');
  lines.push('');

  // _ensure_fallback_cards
  lines.push('static func _ensure_fallback_cards() -> void:');
  for (const card of cards) {
    const slug = getSlug(card);
    lines.push(`\tif not _cards.has(${card.card_id}):`);
    lines.push(`\t\t_cards[${card.card_id}] = _build_${slug}()`);
  }
  lines.push('');

  // Builder functions
  for (const card of cards) {
    const slug = getSlug(card);
    lines.push(`static func _build_${slug}():`);
    emitGdBuilderBody(card, lines);
    lines.push('');
  }

  return lines.join('\n');
}

let _gdVarCounter = 0;

function emitGdBuilderBody(card: CardDef, lines: string[]): void {
  const abilityVarNames: string[] = [];
  _gdVarCounter = 0;

  for (let ai = 0; ai < card.abilities.length; ai++) {
    const ab = card.abilities[ai];
    const varName = card.abilities.length === 1 ? 'main_ab' : `ab${ai}`;

    // Trigger
    const trigVar = emitGdTriggerCode(ab.trigger, lines);

    // Targets
    const targetVars: string[] = [];
    for (const tgt of ab.targets) {
      targetVars.push(emitGdTargetCode(tgt, lines));
    }

    // Effects
    const effectVars: string[] = [];
    for (const eff of ab.effects) {
      effectVars.push(emitGdEffectCode(eff, lines));
    }

    const tgtsArg = targetVars.length > 0 ? `[${targetVars.join(', ')}]` : '[]';
    const effsArg = effectVars.length > 0 ? `[${effectVars.join(', ')}]` : '[]';
    lines.push(`\tvar ${varName} = _new_ability("${escGd(ab.ability_name)}", "${escGd(ab.description)}", ${trigVar}, ${tgtsArg}, ${effsArg})`);
    abilityVarNames.push(varName);
  }

  // Card construction
  if (card.card_type === 'character') {
    lines.push('\tvar card = CharacterCardScript.new()');
    lines.push(`\tcard.card_id = ${card.card_id}`);
    lines.push(`\tcard.card_name = "${escGd(card.card_name)}"`);
    lines.push(`\tcard.card_class = "${escGd(card.card_class)}"`);
    if (card.title) lines.push(`\tcard.title = "${escGd(card.title)}"`);
    if (card.deckbuilding_rules && Object.keys(card.deckbuilding_rules).length > 0) {
      lines.push(`\tcard.deckbuilding_rules = ${serializeGdValue(card.deckbuilding_rules)}`);
    }
    lines.push(`\tcard.description = "${escGd(card.description)}"`);
  } else if (UNIT_LIKE_TYPES.has(card.card_type)) {
    lines.push('\tvar card = UnitCardScript.new()');
    lines.push(`\tcard.card_id = ${card.card_id}`);
    lines.push(`\tcard.card_name = "${escGd(card.card_name)}"`);
    lines.push(`\tcard.card_class = "${escGd(card.card_class)}"`);
    if (card.card_class2) lines.push(`\tcard.card_class2 = "${escGd(card.card_class2)}"`);
    lines.push(`\tcard.cost = ${getCardCost(card)}`);
    if (card.card_type !== 'unit') lines.push(`\tcard.card_type = ${GD_CARD_TYPE_BY_JSON[card.card_type]}`);
    lines.push(`\tcard.attack = ${card.attack ?? 0}`);
    lines.push(`\tcard.hp = ${card.hp ?? 1}`);
    lines.push(`\tcard.move_speed = ${card.move_speed ?? (card.card_type === 'building' ? 0 : 1)}`);
    lines.push(`\tcard.attack_range = ${card.attack_range ?? (card.card_type === 'building' ? 0 : 1)}`);
    if (card.rarity && card.rarity > 0) lines.push(`\tcard.rarity = ${RARITY_GD_MAP[card.rarity] || card.rarity}`);
    lines.push(`\tcard.description = "${escGd(card.description)}"`);
  } else {
    lines.push('\tvar card = SpellCardScript.new()');
    lines.push(`\tcard.card_id = ${card.card_id}`);
    lines.push(`\tcard.card_name = "${escGd(card.card_name)}"`);
    lines.push(`\tcard.card_class = "${escGd(card.card_class)}"`);
    lines.push(`\tcard.cost = ${getCardCost(card)}`);
    if (card.card_type !== 'spell') lines.push(`\tcard.card_type = ${GD_CARD_TYPE_BY_JSON[card.card_type]}`);
    if (card.spell_type && card.spell_type !== 'Azonnali') {
      lines.push(`\tcard.spell_type = ${SPELL_TYPE_GD_MAP[card.spell_type] || 'SpellCardScript.SpellType.INSTANT'}`);
    }
    if (card.spell_range != null) lines.push(`\tcard.spell_range = ${card.spell_range}`);
    if (card.school) lines.push(`\tcard.school = "${escGd(card.school)}"`);
    lines.push(`\tcard.description = "${escGd(card.description)}"`);
  }

  if (card.tags && card.tags.length > 0) {
    lines.push(`\tcard.tags = [${card.tags.map(t => `"${escGd(t)}"`).join(', ')}]`);
  }
  if (card.flavor_text) lines.push(`\tcard.flavor_text = "${escGd(card.flavor_text)}"`);
  if (card.art_path) lines.push(`\tcard.art_path = "${escGd(card.art_path)}"`);

  if (abilityVarNames.length > 0) {
    lines.push(`\tcard.abilities = [${abilityVarNames.join(', ')}]`);
  }

  lines.push('\treturn card');
}

function emitGdTriggerCode(trigger: TriggerDef, lines: string[]): string {
  const varName = `t${_gdVarCounter++}`;
  const params: string[] = [];
  if (trigger.modifier1 && trigger.modifier1 !== 'SELF') params.push(`"modifier1": "${trigger.modifier1}"`);
  if (trigger.modifier2 && trigger.modifier2 !== 'None') params.push(`"modifier2": "${trigger.modifier2}"`);
  if (trigger.game_state_condition) params.push(`"game_state_condition": "${escGd(trigger.game_state_condition)}"`);
  if (trigger.trigger_interactors && Object.keys(trigger.trigger_interactors).length > 0) {
    params.push(`"trigger_interactors": ${serializeGdValue(trigger.trigger_interactors)}`);
  }
  if (trigger.limit_type && trigger.limit_type !== 'NONE') params.push(`"limit_type": "${trigger.limit_type}"`);
  if (trigger.limit_count && trigger.limit_count > 0) params.push(`"limit_count": ${trigger.limit_count}`);
  if (trigger.parameters && Object.keys(trigger.parameters).length > 0) {
    params.push(`"parameters": ${serializeGdValue(trigger.parameters)}`);
  }

  const paramsStr = params.length > 0 ? `, {${params.join(', ')}}` : '';
  lines.push(`\tvar ${varName} = _new_trigger("${trigger.event}"${paramsStr})`);
  return varName;
}

function emitGdTargetCode(target: TargetDef, lines: string[]): string {
  const varName = `t${_gdVarCounter++}`;
  const params: string[] = [];
  if (target.condition) params.push(`"condition": "${escGd(target.condition)}"`);
  if (target.range && target.range !== 0) {
    if (typeof target.range === 'string') {
      params.push(`"target_range_expr": "${escGd(target.range)}"`);
    } else {
      params.push(`"target_range": ${target.range}`);
    }
  }
  if (target.count && target.count !== 1) params.push(`"count": ${target.count}`);
  if (target.prompt) params.push(`"prompt": "${escGd(target.prompt)}"`);
  if (target.trigger_interactor) params.push(`"trigger_interactor": "${escGd(target.trigger_interactor)}"`);

  const paramsStr = params.length > 0 ? `, {${params.join(', ')}}` : '';
  lines.push(`\tvar ${varName} = _new_target("${target.target_type}", "${target.owner}", "${target.targeting}"${paramsStr})`);
  return varName;
}

function emitGdEffectCode(effect: EffectStepDef, lines: string[]): string {
  // Depth-first: emit children first
  const subEffectVars: string[] = [];
  if (effect.sub_effects && effect.sub_effects.length > 0) {
    for (const child of effect.sub_effects) {
      subEffectVars.push(emitGdEffectCode(child, lines));
    }
  }

  const elseEffectVars: string[] = [];
  if (effect.else_effects && effect.else_effects.length > 0) {
    for (const child of effect.else_effects) {
      elseEffectVars.push(emitGdEffectCode(child, lines));
    }
  }

  const choiceGroups: { label: string; varNames: string[] }[] = [];
  if (effect.choices && effect.choices.length > 0) {
    for (const choice of effect.choices) {
      const vars: string[] = [];
      for (const child of choice.effects) {
        vars.push(emitGdEffectCode(child, lines));
      }
      choiceGroups.push({ label: choice.label, varNames: vars });
    }
  }

  // Inline target
  let inlineTargetVar: string | null = null;
  if (effect.inline_target) {
    inlineTargetVar = emitGdTargetCode(effect.inline_target, lines);
  }

  const varName = `e${_gdVarCounter++}`;
  const params: string[] = [];
  if (effect.parameters && Object.keys(effect.parameters).length > 0) {
    params.push(`"parameters": ${serializeGdValue(effect.parameters)}`);
  }
  if (effect.tag) params.push(`"tag": "${escGd(effect.tag)}"`);
  if (effect.target_ref) params.push(`"target_ref": "${escGd(effect.target_ref)}"`);
  if (effect.flow && Object.keys(effect.flow).length > 0) {
    params.push(`"flow": ${serializeGdValue(effect.flow)}`);
  }

  const paramsStr = params.length > 0 ? `, {${params.join(', ')}}` : '';
  lines.push(`\tvar ${varName} = _new_effect("${effect.step || ''}"${paramsStr})`);

  if (inlineTargetVar) {
    lines.push(`\t${varName}.inline_target = ${inlineTargetVar}`);
  }
  if (subEffectVars.length > 0) {
    lines.push(`\t${varName}.sub_effects = [${subEffectVars.join(', ')}]`);
  }
  if (elseEffectVars.length > 0) {
    lines.push(`\t${varName}.else_effects = [${elseEffectVars.join(', ')}]`);
  }
  if (choiceGroups.length > 0) {
    const entries = choiceGroups.map(g => {
      return `{"label": "${escGd(g.label)}", "effects": [${g.varNames.join(', ')}]}`;
    });
    lines.push(`\t${varName}.choices = [${entries.join(', ')}]`);
  }

  return varName;
}

// ---------------------------------------------------------------------------
// 3. GENERATE cards.ts
// ---------------------------------------------------------------------------

function generateCardsTs(): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/generate_cards.ts — DO NOT EDIT MANUALLY');
  lines.push('// Source of truth: data/cards.json');
  lines.push('');
  lines.push("export type CardType = 'character' | 'unit' | 'spell' | 'weapon' | 'trap' | 'nature_force' | 'inspiration' | 'artifact' | 'quest' | 'building';");
  lines.push('');

  // Trigger interface
  lines.push('export interface TriggerDef {');
  lines.push('  event: string;');
  lines.push('  modifier1?: string;');
  lines.push('  modifier2?: string;');
  lines.push('  parameters?: Record<string, any>;');
  lines.push('  game_state_condition?: string;');
  lines.push('  trigger_interactors?: Record<string, string>;');
  lines.push('  limit_type?: string;');
  lines.push('  limit_count?: number;');
  lines.push('}');
  lines.push('');

  // Target interface
  lines.push('export interface TargetDef {');
  lines.push('  target_type: string;');
  lines.push('  owner: string;');
  lines.push('  condition?: string;');
  lines.push('  range?: number | string;');
  lines.push('  count?: number;');
  lines.push('  targeting: string;');
  lines.push('  prompt?: string;');
  lines.push('  trigger_interactor?: string;');
  lines.push('}');
  lines.push('');

  // EffectStep interface
  lines.push('export interface EffectStepDef {');
  lines.push('  step: string;');
  lines.push('  parameters?: Record<string, any>;');
  lines.push('  tag?: string;');
  lines.push('  target_ref?: string;');
  lines.push('  inline_target?: TargetDef;');
  lines.push('  flow?: Record<string, any>;');
  lines.push('  sub_effects?: EffectStepDef[];');
  lines.push('  else_effects?: EffectStepDef[];');
  lines.push('  choices?: { label: string; effects: EffectStepDef[] }[];');
  lines.push('}');
  lines.push('');

  // Ability interface
  lines.push('export interface AbilityDef {');
  lines.push('  ability_name: string;');
  lines.push('  description: string;');
  lines.push('  trigger: TriggerDef;');
  lines.push('  targets: TargetDef[];');
  lines.push('  effects: EffectStepDef[];');
  lines.push('}');
  lines.push('');

  // Card interface
  lines.push('export interface CardDef {');
  lines.push('  card_id: number;');
  lines.push('  card_name: string;');
  lines.push('  card_type: CardType;');
  lines.push('  card_class: string;');
  lines.push('  card_class2?: string;');
  lines.push('  cost?: number;');
  lines.push('  title?: string;');
  lines.push('  attack?: number;');
  lines.push('  hp?: number;');
  lines.push('  move_speed?: number;');
  lines.push('  attack_range?: number;');
  lines.push('  spell_range?: number;');
  lines.push('  school?: string;');
  lines.push('  spell_type?: string;');
  lines.push('  description: string;');
  lines.push('  abilities: AbilityDef[];');
  lines.push('  collectible?: boolean;');
  lines.push('  tags?: string[];');
  lines.push('  deckbuilding_rules?: Record<string, any>;');
  lines.push('}');
  lines.push('');

  // Card catalog — emit cards as JSON-like TypeScript
  lines.push('export const CARD_CATALOG: CardDef[] = ');
  // Direct JSON serialization with proper typing
  const catalog = cards.map(card => ({
    card_id: card.card_id,
    card_name: card.card_name,
    card_type: card.card_type,
    card_class: card.card_class,
    ...(card.card_class2 ? { card_class2: card.card_class2 } : {}),
    ...(card.card_type !== 'character' ? { cost: getCardCost(card) } : {}),
    ...(card.title ? { title: card.title } : {}),
    ...(card.attack != null ? { attack: card.attack } : {}),
    ...(card.hp != null ? { hp: card.hp } : {}),
    ...(card.move_speed != null ? { move_speed: card.move_speed } : {}),
    ...(card.attack_range != null ? { attack_range: card.attack_range } : {}),
    ...(card.spell_range != null ? { spell_range: card.spell_range } : {}),
    ...(card.school ? { school: card.school } : {}),
    ...(card.spell_type ? { spell_type: card.spell_type } : {}),
    description: card.description,
    ...(card.tags && card.tags.length > 0 ? { tags: card.tags } : {}),
    ...(card.deckbuilding_rules && Object.keys(card.deckbuilding_rules).length > 0 ? { deckbuilding_rules: card.deckbuilding_rules } : {}),
    ...(card.collectible === false ? { collectible: false } : {}),
    abilities: card.abilities,
  }));
  lines.push(JSON.stringify(catalog, null, 2) + ';');
  lines.push('');

  lines.push('export function getCardById(cardId: number): CardDef | undefined {');
  lines.push('  return CARD_CATALOG.find(card => card.card_id === cardId);');
  lines.push('}');
  lines.push('');
  lines.push('export function getCardClasses(card: CardDef): string[] {');
  lines.push('  const classes: string[] = [];');
  lines.push('  if (card.card_class) classes.push(card.card_class);');
  lines.push('  if (card.card_class2) classes.push(card.card_class2);');
  lines.push('  return classes;');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

function main(): void {
  console.log('=== Card Pipeline Generator (Trigger/Target/Effect) ===\n');

  // 1. Generate .tres files
  console.log('1. Generating .tres files...');
  if (!fs.existsSync(TRES_DIR)) {
    fs.mkdirSync(TRES_DIR, { recursive: true });
  }
  for (const card of cards) {
    const slug = getSlug(card);
    const tresContent = generateTres(card);
    const tresPath = path.join(TRES_DIR, `${slug}.tres`);
    fs.writeFileSync(tresPath, tresContent, 'utf-8');
  }
  console.log(`   Done: ${cards.length} .tres files written to data/cards/`);

  // 2. Generate card_database.gd
  console.log('2. Generating card_database.gd...');
  const gdContent = generateCardDatabase();
  fs.writeFileSync(CARD_DB_PATH, gdContent, 'utf-8');
  console.log('   Done: scripts/cards/card_database.gd written');

  // 3. Generate cards.ts
  console.log('3. Generating server/src/cards.ts...');
  const tsContent = generateCardsTs();
  fs.writeFileSync(CARDS_TS_PATH, tsContent, 'utf-8');
  console.log('   Done: server/src/cards.ts written');

  console.log('\n=== Generation complete! ===');
}

main();
