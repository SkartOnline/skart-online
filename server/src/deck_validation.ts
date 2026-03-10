import { CARD_CATALOG, CardDef, getCardById, getCardClasses } from './cards';

const ALLOW_ALL_CARDS_FOR_TESTING = true;

export interface SavedDeck {
  id: string;
  name: string;
  characterIds: number[];
  mainCardIds: number[];
  sidedeckIds?: number[];
  created_at: string;
  updated_at: string;
}

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
  normalizedCharacters: number[];
  normalizedMainDeck: number[];
  normalizedSidedeck: number[];
}

function isCharacter(card: CardDef | undefined): boolean {
  return !!card && card.card_type === 'character';
}

function overlapsClass(card: CardDef, allowedClasses: Set<string>): boolean {
  const classes = getCardClasses(card);
  return classes.some(cls => allowedClasses.has(cls));
}

interface CrossClassRule {
  tag?: string;
  type?: string;
  min_cost?: number;
  max_cost?: number;
}

function cardHasTag(card: CardDef, tag: string): boolean {
  return Array.isArray(card.tags) && card.tags.includes(tag);
}

function matchesCrossClassRule(card: CardDef, rule: CrossClassRule): boolean {
  if (rule.tag && !cardHasTag(card, rule.tag)) return false;
  if (rule.type && card.card_type !== String(rule.type).toLowerCase()) return false;

  const cardCost = Number(card.cost ?? 0);
  if (rule.min_cost != null && Number.isFinite(rule.min_cost) && cardCost < rule.min_cost) return false;
  if (rule.max_cost != null && Number.isFinite(rule.max_cost) && cardCost > rule.max_cost) return false;
  return true;
}

export function validateDeckInput(characterIdsRaw: unknown, mainCardIdsRaw: unknown, sidedeckIdsRaw: unknown = []): DeckValidationResult {
  const errors: string[] = [];

  const characterIds = Array.isArray(characterIdsRaw)
    ? characterIdsRaw.map(Number).filter(Number.isFinite)
    : [];
  const mainCardIds = Array.isArray(mainCardIdsRaw)
    ? mainCardIdsRaw.map(Number).filter(Number.isFinite)
    : [];
  const sidedeckIds = Array.isArray(sidedeckIdsRaw)
    ? (sidedeckIdsRaw as any[]).map(Number).filter(Number.isFinite)
    : [];

  if (characterIds.length !== 2) {
    errors.push('Pontosan 2 karakter kell a pakliba.');
  }

  if (mainCardIds.length < 1 || mainCardIds.length > 30) {
    errors.push('1–30 lap kell a fő pakliba.');
  }

  const characterCards = characterIds.map(id => getCardById(id));
  if (characterCards.some(card => !isCharacter(card))) {
    errors.push('A karakter slotban csak karakter lap lehet.');
  }

  const classSet = new Set<string>();
  characterCards.forEach(card => {
    if (!card) {
      return;
    }
    getCardClasses(card).forEach(cls => classSet.add(cls));
  });

  const crossClassTags: string[] = characterCards
    .filter(Boolean)
    .flatMap(c => {
      const rules = (c as any).deckbuilding_rules;
      return Array.isArray(rules?.cross_class_tags) ? rules.cross_class_tags as string[] : [];
    });

  const crossClassRules: CrossClassRule[] = characterCards
    .filter(Boolean)
    .flatMap(c => {
      const rules = (c as any).deckbuilding_rules;
      return Array.isArray(rules?.cross_class_rules) ? (rules.cross_class_rules as CrossClassRule[]) : [];
    });

  const hasCrossClassException = (card: CardDef): boolean => {
    if (crossClassTags.some(tag => cardHasTag(card, tag))) {
      return true;
    }
    return crossClassRules.some(rule => matchesCrossClassRule(card, rule));
  };

  for (const cardId of mainCardIds) {
    const card = getCardById(cardId);
    if (!card) {
      errors.push(`Ismeretlen lap azonosító: ${cardId}`);
      continue;
    }
    if (card.card_type === 'character') {
      errors.push('A fő pakliban nem lehet karakter lap.');
      continue;
    }
    if (!overlapsClass(card, classSet) && !hasCrossClassException(card)) {
      errors.push(`Osztályhiba: ${card.card_name} nem egyezik a kiválasztott karakter osztályaival.`);
      break;
    }
  }

  // Validate sidedeck
  const sidedeckRules = characterCards
    .filter(Boolean)
    .flatMap(c => {
      const rules = (c as any).deckbuilding_rules;
      return rules?.sidedeck ? [rules.sidedeck as { max: number; filter: string }] : [];
    });

  if (sidedeckIds.length > 0) {
    const sidedeckRule = sidedeckRules[0];
    if (!sidedeckRule) {
      errors.push('Nincs karakter, aki Segédpaklit enged.');
    } else {
      if (sidedeckIds.length > sidedeckRule.max) {
        errors.push(`A Segédpakli legfeljebb ${sidedeckRule.max} lapot tartalmazhat.`);
      }
      for (const cardId of sidedeckIds) {
        const card = getCardById(cardId);
        if (!card) {
          errors.push(`Ismeretlen Segédpakli lap: ${cardId}`);
          continue;
        }
        if (card.card_type !== 'unit') {
          errors.push(`A Segédpakli csak egység lapokat tartalmazhat: ${card.card_name}`);
        }
        // Filter check: "!class:X" means card must NOT belong to that class
        const filterStr: string = sidedeckRule.filter || '';
        for (const clause of filterStr.split(',')) {
          const c = clause.trim();
          if (c.startsWith('!class:')) {
            const forbiddenClass = c.slice(7);
            if (overlapsClass(card, new Set([forbiddenClass]))) {
              errors.push(`Segédpakli lap osztályhiba (${forbiddenClass} nem megengedett): ${card.card_name}`);
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedCharacters: characterIds,
    normalizedMainDeck: mainCardIds,
    normalizedSidedeck: sidedeckIds,
  };
}

export function ensureUserCardsCoverDeck(userCards: any[], deck: { characterIds: number[]; mainCardIds: number[] }): string | null {
	if (ALLOW_ALL_CARDS_FOR_TESTING) {
		return null;
	}
  const owned = new Set<number>((userCards || []).map(card => Number(card.id ?? card.card_id)).filter(Number.isFinite));
  const allNeeded = [...deck.characterIds, ...deck.mainCardIds];
  const missing = allNeeded.find(cardId => !owned.has(cardId));
  if (missing !== undefined) {
    const card = CARD_CATALOG.find(c => c.card_id === missing);
    return `Hiányzó lap a gyűjteményből: ${card?.card_name || missing}`;
  }
  return null;
}
