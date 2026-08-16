import { beforeEach, describe, expect, it } from "vitest";
import { BASE_CARD_SET, createGame, legalActions, loadCardSet } from "../engine";
import type { PlayerId } from "../engine";
import { Agent, DEFAULT_AGENT, prune } from "./agent";
import { DEFAULT_LEARN, learnFromTrajectory, returnScale } from "./learn";
import { LinearModel } from "./model";
import { DEFAULT_REWARDS, greedySeat, playGame } from "./selfplay";
import type { Seat } from "./selfplay";

beforeEach(() => {
  loadCardSet(BASE_CARD_SET);
});

const rolls = (seed = 1) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};

describe("prune", () => {
  it("keeps the candidate list inside the budget", () => {
    const state = createGame({ seed: "prune-1", decks: { p1: "felindori", p2: "bestia" } });
    const player = state.turn;
    const raw = legalActions(state, player);
    const params = { ...DEFAULT_AGENT, maxCandidates: 20, hideVariants: 2 };
    const kept = prune(state, player, params, rolls());

    expect(raw.length).toBeGreaterThan(params.maxCandidates);
    expect(kept.length).toBeLessThanOrEqual(params.maxCandidates);
    // Every survivor has to still be a move the engine will accept.
    for (const action of kept) {
      expect(raw).toContainEqual(action);
    }
  });

  it("never drops the decision to stop, however tight the budget", () => {
    const state = createGame({ seed: "prune-2", decks: { p1: "felindori", p2: "bestia" } });
    const player = state.turn;
    const kept = prune(
      state,
      player,
      { ...DEFAULT_AGENT, maxCandidates: 1, hideVariants: 1 },
      rolls(),
    );
    // Stopping is the only alternative to playing, so losing it would make the
    // most important decision in the game unreachable.
    expect(kept.some((a) => a.type === "declareUnitsDone")).toBe(true);
  });

  it("collapses the discard variants of a hidden placement", () => {
    const state = createGame({ seed: "prune-3", decks: { p1: "felindori", p2: "bestia" } });
    const player = state.turn;
    const kept = prune(
      state,
      player,
      { ...DEFAULT_AGENT, maxCandidates: 500, hideVariants: 2 },
      rolls(),
    );
    const byPlacement = new Map<string, number>();
    for (const a of kept) {
      if (a.type !== "playUnit" || !a.faceDown) continue;
      const key = `${a.uid}|${a.slot}`;
      byPlacement.set(key, (byPlacement.get(key) ?? 0) + 1);
    }
    expect(byPlacement.size).toBeGreaterThan(0);
    for (const count of byPlacement.values()) expect(count).toBeLessThanOrEqual(2);
  });
});

describe("Agent", () => {
  it("returns a legal action with the features of its own afterstate", () => {
    const state = createGame({ seed: "agent-1", decks: { p1: "felindori", p2: "bestia" } });
    const player = state.turn;
    const agent = new Agent(new LinearModel(), { ...DEFAULT_AGENT, temperature: 0 }, 5);
    const decision = agent.decide(state, player);

    expect(decision).not.toBeNull();
    expect(legalActions(state, player)).toContainEqual(decision!.action);
    expect(decision!.features).toHaveLength(new LinearModel().inputs);
    expect(Number.isFinite(decision!.value)).toBe(true);
  });

  it("picks the best candidate at temperature zero", () => {
    const state = createGame({ seed: "agent-2", decks: { p1: "felindori", p2: "bestia" } });
    const player = state.turn;
    const model = new LinearModel();
    const w = model.weights();
    w[0] = 0.5; // give it an opinion so the values are not all identical
    for (let i = 1; i < w.length; i++) w[i] = Math.sin(i * 2.3) * 0.4;

    const agent = new Agent(model, { ...DEFAULT_AGENT, temperature: 0 }, 9);
    const decision = agent.decide(state, player)!;
    expect(decision.value).toBeCloseTo(decision.best, 10);
  });

  it("explores at high temperature and settles at zero", () => {
    const state = createGame({ seed: "agent-3", decks: { p1: "felindori", p2: "bestia" } });
    const player = state.turn;
    const model = new LinearModel();
    const w = model.weights();
    for (let i = 0; i < w.length; i++) w[i] = Math.sin(i) * 0.5;

    // The candidate budget is lifted so pruning never has to sample: with a cut
    // in play, two seeds see two different shortlists and the comparison would
    // be measuring the shuffle rather than the softmax.
    const pick = (temperature: number, seed: number) =>
      JSON.stringify(
        new Agent(model, { ...DEFAULT_AGENT, temperature, maxCandidates: 1000 }, seed).decide(
          state,
          player,
        )!.action,
      );

    const greedyPicks = new Set([pick(0, 1), pick(0, 2), pick(0, 3), pick(0, 4)]);
    expect(greedyPicks.size).toBe(1);

    const hotPicks = new Set([pick(2, 1), pick(2, 2), pick(2, 3), pick(2, 4), pick(2, 5)]);
    expect(hotPicks.size).toBeGreaterThan(1);
  });
});

describe("selfplay", () => {
  function botSeat(learn: boolean, seed: number): Seat {
    return { kind: "agent", agent: new Agent(new LinearModel(), DEFAULT_AGENT, seed), learn };
  }

  it("plays a whole game to a finish without truncating", () => {
    const record = playGame(
      { p1: botSeat(true, 1), p2: greedySeat("x") },
      { p1: "felindori", p2: "bestia" },
      "sp-1",
    );
    expect(record.truncated).toBe(false);
    expect(["p1", "p2", "draw"]).toContain(record.winner);
    expect(record.trajectories.p1.steps.length).toBeGreaterThan(0);
    // Only the learning seat is recorded.
    expect(record.trajectories.p2.steps).toHaveLength(0);
  });

  it("credits the winner and debits the loser by the same amount", () => {
    const record = playGame(
      { p1: botSeat(true, 2), p2: botSeat(true, 3) },
      { p1: "felindori", p2: "magus" },
      "sp-2",
    );
    const total = (p: "p1" | "p2") =>
      record.trajectories[p].steps.reduce((sum, s) => sum + s.reward, 0);
    // Zero-sum: every battlefield and the match itself pay one side exactly what
    // they cost the other.
    expect(total("p1") + total("p2")).toBeCloseTo(0, 9);
  });

  it("gives the match reward to whoever the engine says won", () => {
    const record = playGame(
      { p1: botSeat(true, 4), p2: botSeat(true, 5) },
      { p1: "felindori", p2: "magus" },
      "sp-3",
    );
    if (record.winner === "draw") return;
    const total = (p: PlayerId) =>
      record.trajectories[p].steps.reduce((sum, s) => sum + s.reward, 0);
    expect(total(record.winner)).toBeGreaterThan(0);
  });
});

describe("learnFromTrajectory", () => {
  /**
   * A trajectory with known features and a known payout. Learning is tested on
   * this rather than on a played game, because a real trajectory's positions
   * overlap and its target moves, and neither is what these tests are about.
   */
  function synthetic(reward: number, steps = 4) {
    const model = new LinearModel();
    const trajectory = {
      steps: Array.from({ length: steps }, (_, t) => {
        const features = new Float32Array(model.inputs);
        features[0] = 1; // bias
        features[1 + (t % 5)] = 1; // one distinguishing feature per position
        return { features, reward: t === steps - 1 ? reward : 0, value: 0 };
      }),
    };
    return { model, trajectory };
  }

  it("drives the final value to the reward that arrived there", () => {
    const scale = returnScale(DEFAULT_REWARDS);
    for (const reward of [3, -3]) {
      const { model, trajectory } = synthetic(reward);
      const last = trajectory.steps[trajectory.steps.length - 1];
      const target = reward / scale;

      for (let i = 0; i < 400; i++) {
        learnFromTrajectory(model, trajectory, { ...DEFAULT_LEARN, learningRate: 0.05 }, scale);
      }

      // Nothing follows the last position, so its value is exactly the reward:
      // no discounting, no bootstrap, a fixed point the model must reach.
      expect(model.predict(last.features)).toBeCloseTo(target, 2);
    }
  });

  it("shrinks the temporal-difference error until it stops updating", () => {
    const scale = returnScale(DEFAULT_REWARDS);
    const { model, trajectory } = synthetic(3);
    const params = { ...DEFAULT_LEARN, learningRate: 0.05 };

    const first = learnFromTrajectory(model, trajectory, params, scale);
    let last = first;
    for (let i = 0; i < 400; i++) last = learnFromTrajectory(model, trajectory, params, scale);

    // This is the property Adam broke: with plain gradient ascent the update is
    // proportional to the error, so a converged prediction stops moving.
    expect(last.meanAbsDelta).toBeLessThan(first.meanAbsDelta / 10);
  });

  it("propagates a reward backwards to earlier positions", () => {
    const scale = returnScale(DEFAULT_REWARDS);
    const { model, trajectory } = synthetic(3, 3);
    const firstStep = trajectory.steps[0];

    const before = model.predict(firstStep.features);
    for (let i = 0; i < 400; i++) {
      learnFromTrajectory(model, trajectory, { ...DEFAULT_LEARN, learningRate: 0.05 }, scale);
    }
    // The reward lands on the last position; credit reaching the first one is
    // the entire point of the eligibility trace.
    expect(model.predict(firstStep.features)).toBeGreaterThan(before);
  });

  it("learns from a real game without producing anything unrepresentable", () => {
    const model = new LinearModel();
    const record = playGame(
      { p1: { kind: "agent", agent: new Agent(model, DEFAULT_AGENT, 7), learn: true }, p2: greedySeat("y") },
      { p1: "felindori", p2: "bestia" },
      "learn-1",
    );
    const stats = learnFromTrajectory(
      model,
      record.trajectories.p1,
      DEFAULT_LEARN,
      returnScale(DEFAULT_REWARDS),
    );
    expect(stats.steps).toBeGreaterThan(0);
    expect(Number.isFinite(stats.meanAbsDelta)).toBe(true);
    for (const w of model.weights()) expect(Number.isFinite(w)).toBe(true);
  });

  it("does nothing with an empty trajectory", () => {
    const model = new LinearModel();
    const stats = learnFromTrajectory(model, { steps: [] }, DEFAULT_LEARN, 8);
    expect(stats).toEqual({ steps: 0, meanAbsDelta: 0, meanValue: 0 });
  });
});
