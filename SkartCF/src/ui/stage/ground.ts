import { hash } from "./looks";

/**
 * What the ground looks like on each battlefield.
 *
 * The 2D board gives every battlefield a mood through `data-bf` and a line of
 * prose in `game.css`; this is the same table said in low poly: the colours the
 * faceted ground is painted from, the light, and what grows or stands around
 * the board. Keyed by location id like the ambience in `theatre.ts`, so a
 * battlefield added in the workshop gets the neutral ground until it is given
 * one here. Dressing that belongs to one battlefield only (the river under A Pék
 * hídja, the mill's wheel) is phase 4.
 *
 * Pure: a table and a seeded scatter, no three.js.
 */

export type Prop = "pine" | "round" | "dead" | "rock" | "crate" | "column";

export interface Ground {
  /** Facet colours for the open ground, picked per triangle. */
  grass: string[];
  /** The strip along the arcvonal, and the ground right under the board. */
  path: string;
  /** Sky and fog: the colour the distance fades into. */
  sky: string;
  sun: string;
  sunIntensity: number;
  /** How far the fog starts, in world units. Ködrét closes right in. */
  fog: number;
  props: Partial<Record<Prop, number>>;
  /** Tints for the props that take one: leaves, crates, stone. */
  leaf: string[];
  stone: string;
}

const NEUTRAL: Ground = {
  grass: ["#6a8f4a", "#739a50", "#628745"],
  path: "#a58c62",
  sky: "#9cb8c8",
  sun: "#fff0d6",
  sunIntensity: 2.2,
  fog: 16,
  props: { round: 10, pine: 6, rock: 6 },
  leaf: ["#5c9e3c", "#6fb046", "#4f8f38"],
  stone: "#8e8a82",
};

export const GROUNDS: Record<string, Ground> = {
  // A back alley: wet cobbles and soot.
  sikator: {
    ...NEUTRAL,
    grass: ["#5d544b", "#665c52", "#544b43"],
    path: "#3f3833",
    sky: "#6e6a66",
    sunIntensity: 1.5,
    props: { crate: 10, column: 4, rock: 4 },
    leaf: ["#5a5048"],
    stone: "#7a6f64",
  },
  // The black market: plum shadow and cold silver, crates everywhere.
  feketepiac: {
    ...NEUTRAL,
    grass: ["#4a3f55", "#53475f", "#43394d"],
    path: "#6a5a7a",
    sky: "#5d5470",
    sun: "#d8ccff",
    sunIntensity: 1.5,
    props: { crate: 14, column: 3 },
    stone: "#8a809a",
  },
  // An acacia stand: dusty olive under hard light.
  akaczos: {
    ...NEUTRAL,
    grass: ["#8c9a55", "#96a45c", "#7f8d4c"],
    path: "#c2ad76",
    sky: "#d8d4a8",
    sunIntensity: 2.8,
    props: { round: 14, rock: 4 },
    leaf: ["#7c8f3a", "#8a9c42"],
  },
  // The baker's bridge: grass, a light wood, cold river stone.
  a_pek_hidja: {
    ...NEUTRAL,
    grass: ["#6fae4a", "#78b84f", "#63a444"],
    path: "#cdb77e",
    sky: "#a9cde6",
    props: { round: 12, pine: 8, rock: 8 },
    stone: "#9aa2a8",
  },
  // The mage circle: indigo flagstones and standing stones.
  maguskor: {
    ...NEUTRAL,
    grass: ["#3d4468", "#454d75", "#363c5e"],
    path: "#6a70a0",
    sky: "#40466e",
    sun: "#c8ceff",
    sunIntensity: 1.7,
    props: { column: 10, rock: 4 },
    stone: "#8a90c0",
  },
  // Lingadori library: lamplight on old paper and gilt.
  lingadori_konyvtar: {
    ...NEUTRAL,
    grass: ["#7a6040", "#846a48", "#6f5638"],
    path: "#c9a86a",
    sky: "#5a4630",
    sun: "#ffd9a0",
    sunIntensity: 1.8,
    props: { crate: 8, column: 6 },
    stone: "#b8a170",
  },
  // The harbour: brine, verdigris and cargo.
  kikoto: {
    ...NEUTRAL,
    grass: ["#3f6a66", "#467470", "#38605c"],
    path: "#9a8a6a",
    sky: "#8ab8b4",
    props: { crate: 10, rock: 6, column: 3 },
    stone: "#83a8a4",
  },
  // A moonlit clearing: silver-green, the brightest ground in the set.
  oppidium: {
    ...NEUTRAL,
    grass: ["#7fa88f", "#88b298", "#769e86"],
    path: "#c4c8b0",
    sky: "#b8cfd0",
    sun: "#e8f4ff",
    props: { round: 12, rock: 6 },
    leaf: ["#6f9e84", "#7fae90"],
  },
  // The mill: flour dust and dun sacking.
  malom: {
    ...NEUTRAL,
    grass: ["#a89668", "#b2a070", "#9c8a5e"],
    path: "#d8c9a0",
    sky: "#d9cfb2",
    props: { crate: 8, round: 6, rock: 4 },
    leaf: ["#8f9a4a"],
  },
  // The garden of plenty: soft green going to gold.
  faloda: {
    ...NEUTRAL,
    grass: ["#7fa84a", "#8ab452", "#749c42"],
    path: "#d2c078",
    sky: "#cfe0a0",
    props: { round: 18, rock: 3 },
    leaf: ["#6fb046", "#9cb84a", "#d2a53c"],
  },
  // The cursed forest: sick green, almost no light.
  kesergo: {
    ...NEUTRAL,
    grass: ["#34452f", "#3b4d35", "#2e3d29"],
    path: "#4d4a38",
    sky: "#2e3a2c",
    sun: "#c8e0b0",
    sunIntensity: 1.1,
    fog: 10,
    props: { dead: 16, rock: 5 },
    stone: "#5a6454",
  },
  // The fog meadow: flat pale grey, nothing to see, which is the point.
  kodret: {
    ...NEUTRAL,
    grass: ["#8c9490", "#949c98", "#848c88"],
    path: "#b0b4b0",
    sky: "#c4c8c6",
    sunIntensity: 1.6,
    fog: 6,
    props: { rock: 8, dead: 4 },
    stone: "#a0a6a4",
  },
  // Plázs: grass down to the water.
  plazs: {
    ...NEUTRAL,
    grass: ["#7fb05a", "#e0cc92", "#88b862"],
    path: "#e6d49c",
    sky: "#a8d8f0",
    sunIntensity: 2.6,
    props: { round: 6, rock: 6 },
  },
  // Umbra: dark grey, and darker than anything else here.
  umbra: {
    ...NEUTRAL,
    grass: ["#3a3a3e", "#414145", "#343438"],
    path: "#56565c",
    sky: "#2a2a2e",
    sun: "#c8c8d8",
    sunIntensity: 1.0,
    fog: 11,
    props: { dead: 10, rock: 8, column: 3 },
    stone: "#6a6a72",
  },
  // The endless waste: bleached sand under a white sky.
  a_zona: {
    ...NEUTRAL,
    grass: ["#d6c49a", "#dfcea4", "#ccb98e"],
    path: "#e8dab4",
    sky: "#f0ead8",
    sunIntensity: 3.0,
    props: { rock: 10, dead: 3 },
    stone: "#b3a289",
  },
};

export function groundOf(locationId: string | undefined): Ground {
  return (locationId && GROUNDS[locationId]) || NEUTRAL;
}

export interface Placed {
  kind: Prop;
  x: number;
  z: number;
  scale: number;
  turn: number;
  /** Which of the ground's leaf tints, for the props that take one. */
  tint: number;
}

/**
 * Where the props stand: around the board, never on it, never in front of the
 * camera. Seeded by the battlefield, so the same field looks the same every time
 * it comes up and the scenery does not reshuffle on a re-render.
 */
export function scatter(locationId: string, ground: Ground, keepOut: { x: number; z: number }): Placed[] {
  let seed = hash(locationId) || 1;
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return seed / 4294967296;
  };
  const out: Placed[] = [];
  for (const [kind, count] of Object.entries(ground.props) as [Prop, number][]) {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = (rand() * 2 - 1) * 9;
      const z = (rand() * 2 - 1) * 9;
      if (Math.abs(x) < keepOut.x && Math.abs(z) < keepOut.z) continue;
      // The camera sits over the near side; nothing tall between it and the board.
      if (z > keepOut.z - 0.5 && Math.abs(x) < keepOut.x + 1.5) continue;
      if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.8)) continue;
      out.push({ kind, x, z, scale: 0.7 + rand() * 0.6, turn: rand() * Math.PI * 2, tint: Math.floor(rand() * 8) });
      placed++;
    }
  }
  return out;
}
