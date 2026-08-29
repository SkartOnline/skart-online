# The trained bot — removed

The self-play value function this file used to document is gone. It is
recoverable from git history if it is ever wanted back; this note exists so
that the next session knows what happened rather than wondering where
`agent.ts` went.

## What was deleted

`agent.ts`, `features.ts`, `model.ts`, `learn.ts`, `selfplay.ts`, `train.ts`,
`arena.ts`, `balance.ts`, `cardstats.ts`, the whole of `src/bot/weights/`, and
`src/sim/policy.ts` — the trained linear value function over 103 features, the
TD(λ) trainer around it, and the randomised greedy heuristic it was trained
against. With them went the `train`, `arena`, `balance` and `cardstats` scripts
and the `--policy bot` / `--policy greedy` switches on the simulator.

## Why

`src/ui/game/bot.ts` had already replaced the checkpoint with the planner as
the opponent in the app: the trained agent folded battlefields a single card
would have taken and spent its last spell on something that moved no total, and
neither was a weights problem. That left the trained model as a player nobody
faced, still selectable as the policy for balance runs — which is the worst
place for it, because **a balance number is worth exactly what its policy is
worth**. Measuring the card set against a bot no human ever meets tells you
about the bot.

So there is now one player, and the simulator runs it: the planner, on both
seats.

## What is left, and why each piece stayed

| Path | Role |
|---|---|
| `src/bot/planner.ts` | The bot. Θ, Γ, the board optimiser, the belief model. `docs/bot-algorithm.md` is its documentation. |
| `src/bot/observe.ts` | **The mask** — `GameState` cut down to one player's information set. It survived the cull because `belief.ts`, `expect.ts` and `threat.ts` all read it; it was never part of the learned stack, it was underneath it. |
| `src/sim/baseline.ts` | Not a rival policy. The planner speaks for the gathering and the battle and hands every other decision — leszerelés, the scored step, a prompt it has no opinion about — to this. Deleting it would have deleted a third of the planner. |
| `src/bot/stats.ts` | The Wilson interval, which used to live in `arena.ts`. Every harness that reports a win rate off forty games needs it. |
| `src/bot/legacy.ts` | The planner as it shipped before the play-quality review, frozen, so "beats the old bot" does not quietly become "beats itself". |

## Measuring the planner now

- `npm run mirror` — same deck both seats, so the matchup cancels. `--against legacy` (the default) or `--against baseline`, plus `--no-<feature>` ablations.
- `npm run planner` — wasted casts, the play-quality number a weak opponent cannot flatter. Opponents are `baseline` and `neverstop`.
- `npm run sim` — the balance run. Planner on both seats; see `src/sim/run.ts` for the budget it runs at and why that budget is a wall clock rather than a node count.
