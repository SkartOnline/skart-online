import type { Look } from "./looks";

/**
 * The colour of each material role for a look: how one model is dressed as
 * many cards. The roles are the ones the asset contract names
 * (`blender/models.py`); a material with any other name keeps its own colour.
 *
 * The same choices `models.tsx` makes for the primitive bodies, so a unit looks
 * the same whether its model has loaded yet or not.
 */

export const ROLES = ["cloth", "trim", "skin", "hair", "metal", "glow", "legs"] as const;
export type Role = (typeof ROLES)[number];

const DEFAULT_TRIM = "#c9c2b0";

export function paint(look: Look): Record<Role, string> {
  const beastly = look.body === "brute" || look.body === "dragon";
  return {
    cloth: look.cloth,
    // A brute's ridge and paws in an origin's colour when it has one, otherwise
    // a shade darker than the fur, as the primitive body has it.
    trim: beastly && look.trim === DEFAULT_TRIM ? "#2c2a33" : look.trim,
    skin: look.skin,
    hair: look.hair,
    metal: look.metal,
    glow: look.glow,
    legs: look.body === "rogue" ? "#1b1b1f" : "#4a3a2c",
  };
}
