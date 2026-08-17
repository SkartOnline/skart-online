# The self-play bot — handoff

Everything a fresh session needs to pick this up. Read this before changing
anything in `src/bot/`; most of what follows was paid for with a wrong turn.

---

## What it is

A value function trained by self-play, used in two places: as the opponent in
the app (New Game → "Gép, könnyű / Gép, erős") and as the policy the balance
simulator can run instead of the greedy heuristic (`npm run sim -- --policy bot`).

It replaced nothing. `src/sim/policy.ts` still holds the original greedy policy,
kept deliberately as a fixed reference opponent.

### Files

| Path | Role |
|---|---|
| `src/bot/observe.ts` | **The mask.** Cuts `GameState` down to one player's information set. |
| `src/bot/features.ts` | 103 numbers from an observation. `FEATURE_VERSION` lives here. |
| `src/bot/model.ts` | `ValueModel` interface, `LinearModel`, SGD and Adam. |
| `src/bot/agent.ts` | Move selection: afterstate scoring, candidate pruning, softmax. |
| `src/bot/selfplay.ts` | Plays one game, records per-player trajectories and rewards. |
| `src/bot/learn.ts` | TD(lambda) update. `DEFAULT_LEARN` and the learning-rate evidence. |
| `src/bot/train.ts` | Self-play loop, opponent pool, checkpointing, CLI. |
| `src/bot/arena.ts` | Head-to-head with Wilson intervals. |
| `src/bot/cardstats.ts` | Per-card win rates, draw-vs-play, cost curve. |
| `src/bot/balance.ts` | The >75% sweep under greedy and bot side by side. |
| `src/bot/weights/latest.json` | The shipped checkpoint. Bundled into the app. |
| `src/ui/game/bot.ts` | Browser-side loader and difficulty temperatures. |

### Commands

```bash
npm run train -- --iterations 45 --games 60
```
```bash
npm run arena -- --weights src/bot/weights/latest.json --games 300
```
```bash
npm run cardstats -- --games 200 --mirror --temperature 0.35
```

---

## How it works, and why

**Afterstate evaluation.** `applyAction` is pure, so the board resulting from
every legal move is free to compute. The bot scores *positions*, not moves, and
picks the best. This sidesteps the action space entirely: the units phase can
offer 7 cards x 6 slots x 7 discard choices in a set that changes every turn,
and a value over positions does not care how many ways there were to reach one.

**The mask is not optional.** `createGame` shuffles both decks once, up front,
and stores the result as ordered arrays on the state. The whole future draw
order for both players is sitting in `GameState`. A featuriser handed the raw
state learns to read it, scores beautifully, and is worthless: the policy is
unplayable by a human and useless as a balance measurement. `observe.ts` exists
for this and its test is an invariant, not a spot check — *changing what the
viewer cannot see must not change what they see*. Do not weaken it.

**Per-player trajectories.** Turns do not alternate. A spell asking for caster,
then target, then destination is three consecutive decisions by one player, and
`settle` skips a player who has stopped. So each player keeps their own sequence
of decisions and their own rewards, and TD runs within it. Anything keyed off
"a turn happened" would be wrong.

**Rewards** are ±1 per battlefield and ±2 for the match, normalised by
`returnScale` because the model ends in `tanh` and cannot output an 8.

---

## Measured, so nobody re-derives it

All against the greedy policy, sides swapped every other game, Wilson 95%.

| model | training | vs greedy |
|---|---|---|
| untrained (zero weights) | none | **0.0%** |
| lr 0.05 | 360 games | 85.3% [80.9, 88.9] |
| lr 0.05 | 2700 games | 61.0% [55.4, 66.3] |
| **lr 0.01 (shipped)** | **2000 games** | **89.3% [85.3, 92.3]** |
| greedy vs greedy (control) | — | 50–55% |

Shipped model beats the 360-game one head to head, 61.8% [54.9, 68.2] over 200.

The 0% untrained row is the one that matters: it is what proves the 89% is
training rather than an information leak or an engine exploit.

---

## Traps that already cost time

**Adam is wrong for TD.** It normalises each coordinate by its gradient history,
so every step is about `lr` in size whatever the error was. TD converges
*because* a correct prediction produces no update, and Adam deletes that: the
model never settles, it vibrates. Default is `sgd`. Adam is still in `model.ts`
for a future batch-trained net; do not make it the default again.

**Short sweeps rank learning rates backwards.** A fast rate wins any race that
ends early. Over 360 games lr 0.05 looked twice as good as lr 0.01; over 2000+
games lr 0.01 wins and lr 0.05 actively degrades. Never tune a rate on a short
run.

**One training seed proves nothing.** Two sweeps at the same rates, differing
only in run length, produced results that inverted (lr 0.2: 29% and 70%;
lr 0.5/0.6: 94% and 53%). A Wilson interval covers *arena* sampling noise only,
not training variance, which here is much larger. Multiple seeds per setting, or
no claim.

**Temperature 0 makes "0% played" meaningless.** The bot is deterministic, so a
card that is reliably the second-best option is played exactly zero times and
reads as unplayable. Always cross-check card usage with `--temperature 0.35`.
This is what corrected the wrong conclusion that the bot refuses Mesteri spells:
it casts them readily when they are *legal*, and legality is the real
constraint (Kegyelemdöfés was legal on 0 of 452 turns because it needs a damaged
target).

**`FEATURE_VERSION` must be bumped when `features.ts` changes.** Old checkpoints
then refuse to load rather than reading weights from the wrong columns, and
`botAvailable()` in the UI drops the opponent option instead of crashing.

**`arena.ts`'s closing verdict is worded for the 60% gate against greedy.** In a
bot-vs-bot run read the interval against 50%, not the printed sentence.

---

## Known limitations, confirmed in play

Ranked by how much they distort the bot's judgement.

1. **It plays to the wrong target and stops too early.** Observed directly: a
   human beat it 4:0 with margins of 2, 3, 2 and 3. It trains 60% against itself
   and 10% against greedy, and *greedy stops early by construction*, so both its
   opponents stop early and nothing in training punishes a modest board. This is
   self-play equilibrium collapse and it is the top-priority fix.

2. **One-ply search cannot see combos.** Infiltráció → Hátbaszúrás is fully
   supported by the engine (the `csempesz` deck holds both, and all seven of its
   Zsivány casters are legal Infiltráció targets), but the bot never finds it:
   Infiltráció's immediate afterstate looks bad, and the payoff is one move past
   the horizon. Any card in a combo is systematically undervalued, so balance
   verdicts on those cards are not trustworthy.

3. **Non-power statics are invisible.** The features read power, cost,
   spellpower, counts. A unit with `banCasting`, a placement rule or an immunity
   is just a body. This is why the bot opens with Omen: it sees power 10, not
   that Omen shuts off casting for *both* sides, including its own.

4. **No reasoning about information disclosure.** Features describe the board as
   public state. Nothing represents what showing a card teaches the opponent, so
   the bot cannot value concealment or bluffing. Hiding a unit is only ever
   valued through its board effect.

5. **It cannot protect a conditional bonus.** It sees realised power, so placing
   Vízköpő alone in a row correctly reads as +3, but nothing says that bonus
   evaporates if it later fills the row — so it does.

---

## Open work, in priority order

### 1. Potential score, and the stopping calibration

The strongest available idea, and it came from playtesting: the bot should know
what its board *could* reach, not just what it is.

Add features for the best board total still achievable — current power plus the
best set of units from hand that fits inside the remaining cost cap (a greedy
knapsack is fine, this runs in the hot loop), and the same estimate for the
opponent from what is visible. Then `potential.diff` alongside `power.diff`.
Stopping while holding unplayed power should become visible as a cost.

Pair it with a training-mix change, because the features alone will not break a
self-play equilibrium: add a reference opponent that never stops early, so some
fraction of games punish stopping short. The greedy anchor cannot do this, since
it stops early too.

### 2. Two-ply search over a narrow candidate set

Needed for the combos, which the designer says are central (movement plus
Mesteri). Do not widen it to everything: restrict the second ply to spell casts
when a caster exists, and cap the branching hard. Each candidate costs a
`structuredClone`, which already dominates runtime.

Note that honest two-ply needs *determinization* — reshuffling the unseen deck
before evaluating — otherwise the search reads the stored deck order through the
afterstate of any draw effect. There is already a small, bounded version of this
leak on draws; two-ply would make it much worse.

### 3. Deck contents as a multiset

Agreed with the designer: a player knows *which* cards remain in their deck but
not the order. Expose the remainder as counts by card, with no sequence. Should
help stopping decisions most. Bumps `FEATURE_VERSION`.

### 4. The MLP

Only after the above. The features, not the model class, are the current
bottleneck: a linear model that cannot see `banCasting` will not be fixed by
adding hidden layers over the same 103 inputs.

When it is time: keep the `ValueModel` interface, add per-slot inputs (occupancy,
hidden, power, cost, damage, rings, placed, spellpower, keyword one-hot over the
20 distinct keywords) for roughly 500 dimensions, 500x128x64x1 with tanh output.
Hand-written backprop is about 150 lines and costs nothing next to
`structuredClone`; a dependency is permitted but was deliberately not spent,
partly because inference has to run in the browser off a plain JSON file.
Gradient-check against numerical differences — there is already a test doing
this for the linear model to copy.

---

## Card and deck bugs this turned up, still unfixed

Independent of the bot, found by using it. The trims are design decisions and
were deliberately left to the designer.

**Three decks exceed 30 cards and are silently truncated.** `sizeTo` in
`setup.ts` does `cards.slice(0, size)` with no warning, cutting in
`Object.entries` order — so whatever was declared last is deleted, which is
usually the card being tested.

```
bestia    units:  34 -> drops dionzosz x2, faun x1, altus x1
magus     spells: 34 -> drops geomancia x2, csabitas x1, valosagtores x1
elettelen units:  31 -> drops kincskereso x1 of 2
```

`bestia` loses **every Druida caster it owns**, which is why its 11 Druida
spells (37% of its spell deck) have never once been castable in any simulated
game. Planned fix: a deck-size check in `validateCardSet` so the collection
screen flags it, with the trims left to the designer.

**Decks holding spells no unit in them can cast.** Separate from truncation:

- `elettelen`: 9 of 30 spells permanently dead (Explar x3, Álomfogó x3,
  Acélpenge x3 — needs Mágus or Harcos casters it does not field)
- `felindori`: 2 Zsivány spells, no Zsivány caster

**Kegyelemdöfés is effectively dead.** Legal on 0 of 452 turns holding it. It
needs a *damaged* enemy at range 1, and damage rarely lingers — most damage that
lands kills instead.

**Umbradog and A Moirák** win 92–100% of battlefields they stand on in mirror
matches. The designer intends to nerf both.

---

## The bot damages its own units

Reported from play against the **strong** checkpoint (temperature 0.04, so this is
the model's considered choice rather than exploration noise): it cast a damage
spell on one of its own units and handed over a battlefield it had already won.

This is not a targeting bug in the engine. Every legal target is offered to both
players, `side: "any"` spells genuinely may be aimed at your own board — Áldozás
and Lélekszipoly need it — and nothing in the rules forbids the play. The bot
simply evaluated the resulting position as better.

Why it can happen at all, from the shape of the learner:

- **The value model is linear.** `power.diff` is one weight over one number, so a
  position is scored by adding up features that cannot interact. "Damage on a unit
  of mine" and "damage on a unit of theirs" reach the model mostly through
  features that are not signed per side with enough resolution to separate them,
  and a linear model cannot represent "this is good on their board and bad on
  mine" for a feature that does not distinguish the two.
- **Damage scores nothing until it kills.** A damage token that does not reach the
  unit's power changes no total (9.5.2), so the afterstate a self-damage cast
  produces is *numerically almost identical* to the afterstate of not casting —
  right up to the point where it kills. If the difference in value is inside the
  model's noise, the softmax will pick it sometimes, and at temperature 0.04 it
  picks it when the noise happens to favour it.
- **Spending a spell is not penalised.** Casting costs spellpower and a card, and
  neither shows up as a cost in the reward: the reward arrives per battlefield and
  per match. A move that does nothing is therefore free, and a move that does
  something slightly wrong is nearly free.

Worth fixing when the MLP lands, and the MLP is the right place for it: a hidden
layer can represent "damage, on my side" as a conjunction, which a linear model
cannot. Two things to do alongside it:

1. **Sign the damage features per side** so "damage I am carrying" and "damage
   they are carrying" are separate inputs rather than one aggregate.
2. **Check it directly.** Count, over a self-play batch, how often a controller
   targets its own unit with a damaging effect. It should be near zero except for
   the cards that want it. That number is the regression test, and it can be
   measured before and after without waiting for a human to notice a thrown game.

Until then the strong bot occasionally throws a won battlefield, and that is
worth knowing when reading its win rates.
