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
  /** The town's dusk leaves room for its oil lamps; other fields keep the default. */
  ambientIntensity?: number;
  /** Oil lamps allowed to light a Blender-built field (desktop; phones get two). Default 4. */
  lampLights?: number;
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
  // The town at three times of day (docs/art-bible.md §4). The alley is night:
  // a weak cold moon, a slate sky, and the oil lamps carry the warmth. The
  // fill stays high enough that every unit still reads against the stones.
  sikator: {
    ...NEUTRAL,
    grass: ["#5d544b", "#665c52", "#544b43"],
    path: "#3f3833",
    sky: "#3c4357",
    sun: "#a9b8d8",
    sunIntensity: 0.95,
    ambientIntensity: 1.25,
    // The town is a backdrop past the houses on the square: the fog takes it early.
    fog: 11,
    props: { crate: 10, column: 4, rock: 4 },
    leaf: ["#5a5048"],
    stone: "#7a6f64",
  },
  // The black market at dusk: the alley's stone under a low amber sun.
  feketepiac: {
    ...NEUTRAL,
    grass: ["#625c53", "#70675b", "#554f48"],
    path: "#877b68",
    sky: "#7a6d6e",
    sun: "#f4bf86",
    sunIntensity: 1.15,
    ambientIntensity: 0.7,
    fog: 11,
    lampLights: 3,
    props: { crate: 14, column: 3 },
    stone: "#82796d",
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
  // The harbour in late afternoon: the same poor town, opening onto a sunny quay.
  kikoto: {
    ...NEUTRAL,
    grass: ["#898073", "#968b7b", "#7c756b"],
    path: "#afa18b",
    sky: "#a5c5ce",
    sun: "#ffe2b0",
    sunIntensity: 3.3,
    ambientIntensity: 1.25,
    fog: 11,
    // Afternoon sun: the lamps are glass, not lights.
    lampLights: 0,
    props: { crate: 10, rock: 6, column: 3 },
    stone: "#9c9384",
  },
  // The golden forest: everything is gold, and nothing lights it but torches.
  // A warm, faint key from the usual corner stands in for torchlight on the
  // board, so units read; the dark close round it is the point.
  oppidium: {
    ...NEUTRAL,
    grass: ["#8a6a2c", "#b08a3e", "#6e5524"],
    path: "#6e5524",
    sky: "#1a140b",
    sun: "#ffc978",
    sunIntensity: 1.5,
    ambientIntensity: 1.6,
    fog: 9,
    props: { round: 12, rock: 6 },
    leaf: ["#b08a3e", "#cfa955"],
    stone: "#8a6a2c",
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
  // The Undan camp in the forest: plain daylight on trampled earth, the
  // firelight barely showing, a green haze between the trees.
  kesergo: {
    ...NEUTRAL,
    grass: ["#7a6c58", "#6b5e44", "#4f553c"],
    path: "#7a6c58",
    sky: "#9db5ad",
    sun: "#fff0cf",
    sunIntensity: 3.2,
    ambientIntensity: 1.3,
    lampLights: 3,
    fog: 11,
    props: { pine: 12, round: 8, rock: 4 },
    leaf: ["#4d6a3a", "#3c5230", "#6a7f45"],
    stone: "#6d6a60",
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
  // Umbra, the prison of the dead: no sky, blue fire on the pillars and a
  // cold fill that keeps the drab flagstones readable under the units.
  umbra: {
    ...NEUTRAL,
    grass: ["#605e58", "#6f6c65", "#4c4b47"],
    path: "#4c4b47",
    sky: "#161a26",
    sun: "#a9bde6",
    sunIntensity: 0.9,
    ambientIntensity: 2.2,
    fog: 9,
    props: { column: 6, rock: 6 },
    stone: "#6b6a64",
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
