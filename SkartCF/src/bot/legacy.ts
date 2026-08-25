/**
 * The bot as it shipped before the play-quality review, frozen.
 *
 * Its own module rather than a constant inside the harness, so measuring
 * against it costs an import and not a sixty-game sweep — `mirror.ts` runs on
 * load, and a probe that wanted this constant got the whole harness with it.
 */

import { DEFAULT_BOARD } from "./board";
import { DEFAULT_PLANNER } from "./planner";
import type { PlannerParams } from "./planner";

/**
 * Cards free in both phases, Θ at face value, no exposure term, finalists by
 * rank alone.
 *
 * This is the opponent, and it needs to stay exactly this even as the defaults
 * move — otherwise "beats the old bot" quietly becomes "beats itself".
 */
export const LEGACY_PLANNER: PlannerParams = {
  ...DEFAULT_PLANNER,
  secure: false,
  thetaWeight: 1,
  board: { ...DEFAULT_BOARD, perDepth: 0, thetaWeight: 1, exposure: 0 },
};

