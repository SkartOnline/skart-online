import { BASE_CARD_SET, loadCardSet, mergeCardSets, validateCardSet } from "../engine";
import type { CardSet } from "../engine";

/**
 * Cards authored in the in-app editor are stored as an overlay on top of the
 * shipped JSON, in localStorage. Same id replaces, new id adds.
 *
 * The site is static, there is no server to write `src/data/*.json`, so the
 * editor's Export button is the bridge back into the repo: download the merged
 * file, drop it into `src/data`, and the overlay becomes the baseline.
 */

const STORAGE_KEY = "skartcf.cards.v1";

export type CardOverlay = Partial<CardSet>;

export function readOverlay(): CardOverlay {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CardOverlay) : {};
  } catch {
    return {};
  }
}

/**
 * Storage can be unavailable, a sandboxed iframe, private browsing, a full
 * quota. Losing persistence is survivable; losing the edit you just made
 * because the write threw is not, so failures here are swallowed and the
 * in-memory card set carries on.
 */
export function writeOverlay(overlay: CardOverlay): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay));
  } catch {
    // no persistence this session
  }
}

export function clearOverlay(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored to clear
  }
}

/** Merges the overlay onto the base set and installs it into the engine. */
export function installOverlay(overlay: CardOverlay): CardSet {
  const merged = mergeCardSets(BASE_CARD_SET, overlay);
  loadCardSet(merged);
  return merged;
}

export function issuesFor(overlay: CardOverlay) {
  return validateCardSet(mergeCardSets(BASE_CARD_SET, overlay));
}

export function download(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
