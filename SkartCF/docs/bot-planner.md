# The planner — a bot that computes its move

`docs/bot.md` describes the self-play bot: a linear value function over 103
aggregate features, one ply, trained by TD. This document describes what is
being built next to it and why, and it is where the design argument lives.
Read this before touching `src/bot/plan/`.

The short version: the learned bot guesses the whole game at once, and there is
only a small part of this game that actually needs guessing. Most of it is
arithmetic the engine will do for free.

---

## The brief

From the designer, in their words, condensed:

> Each unit needs a "score". Base values roughly the base power plus some
> spellpower and ability mods. The bot needs to take both its hands into
> account and play towards the highest-scoring board. Then look at the enemy
> board too — a unit a Bérgyilkos can kill raises that Bérgyilkos's score.
> There are only six slots, so it is not hard to compute the boards with the
> highest raw total, the boards that reach a threshold with the fewest cards,
> and the boards that take power off the enemy. Once the boards are fixed, work
> out which spells swing the gap and how to allocate them.
>
> The only true learning needed is the part that cannot be calculated:
> anticipating the opponent's cards, when to hide, when to stop committing,
> when to toss, and the score tuning itself.

That is the design. Everything below is how it maps onto this engine.

---

## Why the learned bot cannot get there from here

Both of the designer's complaints have a mechanical cause, and neither is a
tuning problem.

### It casts harmful spells on its own units

A spell is not one action. `castSpell` names the card; the engine then asks for
a caster, a target and sometimes a destination, one `chooseSlot` at a time. The
agent scores each of those questions separately, on the afterstate of that one
answer.

At the moment it picks a target for a damage spell, the two boards it is
comparing differ by a damage token — and a damage token that does not reach the
unit's power changes no total at all (9.5.2). In the feature vector the whole
difference between "damage them" and "damage me" is `damaged.theirs` versus
`damaged.mine`, two counts of *units*, each with one weight. Not amounts, not
relative to power, and nothing that ties either to who is casting. The choice is
inside the model's noise, so at temperature 0.04 it goes whichever way the noise
falls.

Measured over 25 games per policy, points of damage the acting player put on
their own board during the battle phase:

| policy | casts | self-damage | per game |
|---|---|---|---|
| baseline (`sim/baseline.ts`) | 438 | 132 | 5.3 |
| trained bot (`weights/latest.json`) | 71 | 32 | 1.3 |
| **planner (`bot/plan/cast.ts`)** | **445** | **28** | **1.1** |

Per cast that is 0.30, 0.45 and **0.06**. The bot's low per-game figure is not
restraint, it is silence: it cast 71 spells where the other two cast ~440 in the
same games, which is limitation 1 in `bot.md` showing up as a number.

The residual 1.1 is not all error — Áldozás and Lélekszipoly are supposed to aim
inwards, and a unit of yours can die to your own board changing shape.

### It ignores positioning

Two causes, both in `agent.ts`.

**The candidate list is truncated at random.** Measured over five whole games:
the units phase offers **149.8 legal actions on average**, of which only 23.7
are face-up placements — the rest are the same placement paid for with each of
the seven different cards you could discard to hide it. `DEFAULT_AGENT`
evaluates 40. On **59% of units-phase decisions** the list is over budget, and
`prune` fills the remaining room with a *random sample* of placements. The tile
that makes Ninja isolated, or puts Bérgyilkos in the right column, is frequently
never scored at all.

**The objective is one-sided.** Even the deterministic baseline maximises
`boardTotal(me)` and nothing else (`theoreticalMax`). A Bérgyilkos dropped into
the right column removes an enemy unit — that is a swing of its power, and it
appears nowhere in a total that only sums your own side. Every removal Belépő in
the set is invisible to that objective. The fix is not a card list; it is
subtracting their total from yours.

---

## The architecture

Five pieces. Each is a pure function of the state, and each is testable on its
own.

```
                            ┌──────────────┐
   units phase   ───────────│  board.ts    │  beam search over placements
                            │  value.ts    │  the score, in power points
                            │  threat.ts   │  what the enemy board becomes
                            └──────┬───────┘
                                   │ target board
                            ┌──────▼───────┐
   battle phase  ───────────│  cast.ts     │  complete casts, allocated
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐
   the residue   ───────────│  tune.ts     │  the numbers that cannot be derived
                            └──────────────┘
```

### The currency: power points

Every number in the planner is denominated in board power, because board power
is literally what decides a battlefield (5.5). A card in hand is worth ~0.8
points. A point of damage banked on an enemy unit is worth 0.25 points. Being
ahead by 9 rather than 3 is worth 0.35 points a head. That commensurability is
what lets a single comparison decide between "kill their unit", "add to my
board" and "keep the card", and it is what makes the parameters tunable: they
are all exchange rates against one unit of account.

### `value.ts` — the score (done)

**A first draft of this document claimed the score for an on-board unit was
just `power()`, and that anything else would be a worse copy of `power.ts`.
That was wrong, and it is worth writing down why, because it is the crux of the
whole design.**

`power()` says what a unit is *counting for*. The score says what it is *worth*,
and the two come apart everywhere that matters:

| the pair | `power()` | what a player sees |
|---|---|---|
| Felindori bajnok, front row vs back row | 7 and 7 | only the front one can aim a Harcos spell, or get anything out of Falanx, Kopja or Egységben az erő |
| Maffiavezér vs Felindori kardforgató | 4 and 4 | one has an aura and a Zsivány 4 pool. Deplete the pool and fill the neighbourhood and they really are equal |
| Maffiavezér, middle vs corner | 4 and 4 | the corner one will only ever reach two tiles — true before a single ally exists |
| Vízköpő alone in its row vs a plain 5 | 5 and 5 | three of the Vízköpő's five evaporate the moment anything joins its row, and *either* player can arrange that |
| Celebrant vs Ogre | 7 and 7 | one of them holds Mágus 10 and can take a board apart. It is a far better thing to kill |

So the score is `power() + option value`, where option value is three terms:

**Cast potential.** Per school, what the unit's *remaining* pool can actually
buy from the tile it is standing on: best value per point of cost first, until
the pool runs out. Two gates do the positional work. `aimable()` asks whether
any legal target exists within `effectiveRange` of *this tile* — which is the
whole of the front-row/back-row question, since a range-1 Harcos spell from the
back row reaches nothing. And an `attach` spell is priced by running the
attachment's own statics through `conditionHolds` at this tile, so Falanx is +1
in front and 0 behind, and Kopja pays only with an enemy standing opposite.

**Aura potential.** `slotsInScope()` says a middle tile reaches three and a
corner reaches two, whatever is standing on them. Only *empty* reachable tiles
are counted — the occupied ones are already inside `power()`, and counting them
twice would make an aura unit look better the more it had already paid out.

**Contingency.** A bonus resting on a breakable condition is not worth its face
value. `CONDITION_FRAGILITY` prices each entry of the shared `StaticCondition`
enum from 0 to 1, and the ordering is the argument: standing alone is one
placement away from ending and either player can make that placement, while
standing in the front row only ends if somebody spends a move spell.

Read on the enemy's board, that last term is also what says "move something
into the Vízköpő's row" is worth three points without any spell dealing damage.

None of it names a card. Every term comes from an engine accessor or from a
table keyed on the shared `kind` / `StaticCondition` enums — the same extension
points a new card uses. `value.test.ts` is the five rows of that table, one test
each, asserting the *ordering* rather than the numbers, because the numbers are
meant to be fitted later and the ordering is the claim that has to survive it.

**Power and option value must never be added into one number and compared
against a total.** A battlefield is decided by power and nothing else (5.5).
Option value decides which unit to kill, protect or build around; power decides
who wins. In `cast.ts` it enters as a separate, small term (`threat`, 0.5) that
can break a tie in targeting and can never outweigh the total it is advising on.

### `knowledge.ts` — what the bot is allowed to know (done)

Settled by the designer: **the bot knows which deck you brought, and never your
hand.** That makes exactly one thing computable — what you have not shown yet —
and one subtlety has to be got right.

The unseen pool must be counted over `deck + hand together`. Either one alone
leaks, because the split between them *is* the hidden information; their union
is the public fact a player at the table reads off a decklist and a graveyard.
`castableSpells` then lists our own hand card for card, and theirs as distinct
cards each carrying the chance that a copy is in hand right now — copies drawn
against pool size. That expectation is the whole of the "guess what they are
holding" problem, and it lives in one file so nothing else is tempted to peek.

### `board.ts` — the target board (done)

**Enumerate face-up placements only.** The 149.8-action figure above is not a
branching factor, it is a mistake: `legalActions` offers every hidden placement
once per card that could pay for it, so one tile becomes seven actions that
differ only in what goes to the graveyard. Crossing "where does this unit go"
with "what do I throw away" is what buries the 23.7 real choices inside 150.
The planner enumerates the **face-up placements**, settles on a board, and only
then asks the separate question: which of these units is worth hiding, and
which card in hand is least needed by the boards worth building? Hiding is a
decision *derived from* the plan, never a dimension of the search.

That leaves 23.7 candidates a turn instead of 150, and none of them are cut.

Six slots and a hand of seven is still not as small as it looks: subsets placed
into ordered slots run to tens of thousands of configurations, and placement
order matters whenever a Belépő is involved. So: **beam search over placement
sequences**, evaluated in two tiers.

**Tier one, free.** A candidate board is a shallow spread:
`{...state, board: {...state.board, [slot]: instance}}`. No `structuredClone`,
and `power()` reads every static, aura, adjacency and positional bonus off it
correctly. This is the tier the enumeration runs in.

**Tier two, 0.17 ms.** A real `applyAction` probe. Spent only where tier one is
wrong: units carrying a Belépő, placement rules, the cost cap, and the final
handful of candidates. Of the 89 units in the set, 29 carry a Belépő, 33 carry a
static and 22 are plain bodies — so tier two runs on a minority of the branching.

The objective carries all three of the boards the brief asks for, because they
are three terms rather than three searches:

```
value(board) = myTotal − theirTotalAfterMyPlacements     ← the denial board
             − cardValue × cardsSpent                    ← the efficient board
             + shaped surplus past the winning margin     ← the raw board, discounted
```

Ranking one beam by that expression yields the cheapest board that clears their
total when a cheap board will do it, and the biggest board when it will not.

**Hiding is decided after the board is.** Concealment buys exactly one thing:
the opponent has to bid against a number they cannot see. So it is worth nothing
once they have said kész, it is never worth more than the card it costs, and the
card it costs comes out of `plan.spare` — the hand cards the chosen board turned
out not to need, worst first. Three parameters: what concealment is worth, how
big a body has to be before it is worth lying about, and how much of a spare
card's printed power counts against spending it.

**Stopping is an outcome, not a rule.** Every placement is charged `cardValue`
and every point past `winMargin` is discounted, so a plan that adds nothing
worth its card comes back empty — and because the number it is measured against
is the opponent's *reachable* total rather than their current one, coming back
empty while they can still build is hard. The baseline's `foldMargin` has no
counterpart here.

### `threat.ts` — the enemy (done)

**A face-down unit conceals its cost as well as its face.** An earlier draft of
this document assumed the price was readable off `capSpent`; it is not, and
`visibleCapSpent` exists in `totaling.ts` precisely because 1.5.3 says nobody
audits the other player's tally mid-gathering. So there is no price tag to read
a hidden unit's size off.

What is public: their revealed units at their real power, the tiles, their hand
sizes, their graveyard, the battlefield's cap, the *visible* part of their cap
spend, and the deck they brought. From that, two numbers:

- **`estimatedTotal`** — their board now, hidden units valued at the mean power
  of the cards they have not shown, biased up (`hideBias`) because nobody spends
  a card of hand to conceal a rabbit, and bounded above by what the cap they
  demonstrably have left could still buy at their own deck's best rate.
- **`reachableTotal`** — what that board could still *become*, from the tiles
  they have left, the cap they have left (read the public way) and the best of
  what they have not shown, discounted by `potential` because they hold seven of
  thirty rather than the whole deck.

Building against the first number is how a bot stops one point ahead and then
watches the battlefield walk away — limitation 1 in `bot.md`. Building against
the second is what the designer means by not stopping short, and it is why
stopping needs no rule of its own here.

### `cast.ts` — the allocation (done)

The battle phase is open information from Mustra onwards, so it is not a
judgement call at all. It is arithmetic with two unknowns (their remaining hand,
and what a kept card is worth), and both are parameters.

A cast is treated as **atomic**. Every way one spell can finish is enumerated as
a *line* — the actions that get there and the board they leave — and scored
whole. Measured over five games, a battle turn offers **21 complete lines on
average** and 145 at the worst, so this is exhaustive rather than sampled, and
13% of those lines actively lose ground for the caster. Those 13% are what the
one-answer-at-a-time policies keep stumbling into.

Only the first action of the best line is ever played; nothing is remembered.
The same walk that opens a cast also *finishes* one already in flight, so a
target pick is chosen by the best completion available from the board as it
actually stands — which is what makes the plan robust to a trap, a Belépő or an
opponent's spell moving the board underneath it.

The lookahead is what finds the designer's example. Two damage onto a five-power
unit changes no total; four more onto the same unit kills it; neither spell
alone is worth casting. One ply cannot see that, so ply-1 lines are *ordered* by
their own value and *chosen* by their best continuation. `cast.test.ts` pins
that exact scenario.

**Reading the deck through an afterstate is the trap here.** `createGame`
shuffles both decks up front and stores the order, so any scorer that looked at
what a draw effect produced would be reading the future off the state.
`positionValue` therefore reads the board and hand *sizes* only. Card advantage
still gets priced, because a line's cost is counted off hand sizes rather than
off what the spell claims to do — a draw comes out negative, a Mesteri finish
comes out as two, and no card is named anywhere.

### `tune.ts` — fitting the numbers (done)

Twenty-two knobs, listed in `params.ts`, every one of them an exchange rate
against a point of board power. That single unit of account is what makes them
fittable at all: "a card in hand is worth 0.8" and "a point of banked damage is
worth 0.25" are claims about the same currency, so a search can trade one
against the other.

Two of the nested blocks are *shared* rather than duplicated. One `ScoreParams`
and one `ThreatParams` are built and handed to both phases, because a unit's
option value must not depend on which phase is asking — a board planner and a
cast planner that disagree about what a Celebrant is worth will spend cards
undoing each other. Six dimensions saved, and one class of incoherence made
unrepresentable rather than merely discouraged. `params.test.ts` pins it.

**An evaluation is deterministic, and that is the whole method.** The planner
has no randomness in it, `applyAction` is pure, and the baseline and a
temperature-0 checkpoint are deterministic too. So a fixed list of game seeds
turns the win rate into an ordinary function of the parameter vector, with no
sampling noise at all. Two candidates are compared on *identical* games — common
random numbers taken to its limit — and a step that looks like an improvement is
one. This is why fitting twenty-two numbers on a few dozen games a round is
possible here and would not be in a game with a shuffle inside the policy.

What that buys in variance it owes back in overfitting, and two things answer
that. The fit seed and the holdout seed are disjoint, the holdout is never
optimised against, and the holdout number is the one reported. And the fit set
*rotates* every `--rotate` rounds onto a fresh block of games, with the
incumbent re-scored on them so comparisons stay paired — which turns "fitted to
thirty-two games" into "fitted to a few hundred" over a long run, for one extra
evaluation per rotation.

**The search objective is mean battlefield margin, not win rate.** Both are
deterministic, but a margin runs from −4 to +4 where a result is 0 or 1, so it
separates two nearly-equal vectors that would otherwise tie on games won. Win
rate is what gets reported.

The search is (1+λ): λ candidates go out to λ worker processes, the best comes
back, the step size grows on success and shrinks on failure. Only `width` of the
twenty-two knobs move per candidate — moving all of them makes every step a
referendum on the whole vector, and on a rugged objective that mostly produces
rejections. Every accepted improvement is written to the output file
immediately, so a run can be stopped at any point and `--resume`d.

```bash
npm run tune -- --games 32 --rounds 44 --lambda 6 --width 4 --against baseline
```

Budget: about 4.5 s a game, so a round of λ=6 candidates at 32 games each costs
roughly four minutes wall-clock on eight cores. This is a `npm run sim`-shaped
command — a deliberate act measured in hours, not a check.

#### The first fit failed, and how

Worth writing down in full, because the failure is more instructive than the
machinery. Run `fitA`: 44 rounds, λ=6, 32 games a round, five rotated game
blocks, fitted against `baseline` alone. It is kept at
`src/bot/plan/fits/fitA-baseline-only.json`.

| stage | result |
|---|---|
| fit set, start | margin 0.750, 62.5% |
| fit set, after 20 accepted moves | margin 1.688, 75.0% |
| holdout, 120 fresh games vs baseline — hand-written | 65.4% [56.5, 73.3] |
| holdout, 120 fresh games vs baseline — fitted | 67.5% [58.7, 75.2] |
| **head to head, 160 games, fitted vs hand-written** | **48.1% [40.5, 55.8]** |

Twelve points of gain on the games it was shown. Two points on fresh games. And
nothing at all — a hair below even — against the vector it started from.

**A holdout changes the games, not the opponents.** That is the hole. The
rotation and the disjoint holdout seed guarded against fitting to particular
*games*, and they worked: the block-rotation lines in the log show the
overfitting being paid back every eight rounds. Neither guards against fitting
to a particular *opponent*, and with a deterministic reference that is the
larger of the two effects by far. Every gain the search found was a way to beat
`baseline` specifically.

The fitted vector says so out loud. Three of the twenty-two knobs came back
pinned to a bound, and pinning is the search telling you it is exploiting rather
than learning:

- `cast.cardValue` → 0 — spell cards are free, empty the hand. Safe against an
  opponent that will not punish you for it, wrong in general.
- `threat.hideBias` → 2.5, the ceiling — every hidden unit assumed enormous.
- `board.surplusClosed` → 0.

Two changes came out of it, both in the code now. `EvalOptions.against` is a
*list*, walked across the game list, so a fit can be scored against a pool —
`baseline`, a checkpoint, and the planner's own shipped vector — and a trick
that only beats one of them cannot win. And `arena.ts` no longer prints the 60%
gate verdict at matchups it was never written for: a planner-versus-planner run
reading "below the 60% gate" says nothing about which one is better, and that
line came within one careless reading of shipping a worse bot.

**No fit ships until it has beaten the vector it started from head to head.**
That comparison is paired — same games, same seats, the two vectors playing each
other — which makes it far more sensitive than comparing two win rates against a
third party, and it is the only one of the three rows above that turned out to
mean anything. Fits live in `src/bot/plan/fits/`; the planner's defaults are
still the hand-written ones.

```bash
npm run arena -- --challenger planner:src/bot/plan/fits/fitA-baseline-only.json --against planner --games 160
```

## Invariants

- **No card-specific branches, anywhere.** The engine's rule extends to the bot.
  Every ability reaches the planner either as a measured difference through
  `applyAction`, or as a generic term keyed on effect `kind`.
- **`power()` is the evaluator.** Never re-implement a bonus the engine already
  computes. If a static is priced wrong, the bug is in the probe, not in a
  missing term.
- **Public information only.** Board, hand sizes, cap spent, graveyard, the
  battlefield. Never hand contents, never deck order. This is not fair play
  for its own sake: a policy that reads the shuffle is unplayable as an
  opponent and worthless as a balance measurement.
- **No memory between decisions.** Every phase re-derives its plan. A plan
  cached across a Belépő or a trap is a plan for a board that no longer exists.
- **The planner is added beside the learned bot, never on top of it.** `Seat`,
  `Contender` and `Contestant` all carry a `planner` variant, so
  `npm run arena -- --challenger planner --against <anything>` is the referee
  for every claim in this document.

---

## Where it stands

| phase | piece | state |
|---|---|---|
| 1 | `cast.ts` — complete-cast search and allocation | **done** |
| 1 | `value.ts` — the score | **done**, unfitted |
| 1 | `knowledge.ts` — the information gate | **done** |
| 2 | `board.ts` — the target board, hiding, stopping | **done**, unfitted |
| 3 | `threat.ts` — hidden units and the enemy's reachable board | **done**, unfitted |
| 4 | `tune.ts` — the fitting machinery | **done** |
| 4 | a fit that survives a head-to-head | **not yet** — see above |

Every constant in `DEFAULT_BOARD`, `DEFAULT_SCORE`, `DEFAULT_THREAT` and
`DEFAULT_CAST` is still a hand-written guess — twenty-two numbers, all exchange
rates in power points. The tests assert *orderings* rather than values
specifically so a fit can move them freely. The first fit did not earn the right
to; the machinery to try again properly is in place.

There are no difficulty levels, by the designer's decision: the bot plays as
well as it can. Whatever `src/ui/game/bot.ts` does with temperature today does
not carry over to the planner.

`plan/policy.ts` now routes every phase to the planner; nothing falls through to
the baseline any more. Leszerelés is the one decision it declines to make — it
keeps everything, because tossing is optional and the refill comes out of a
finite deck.

### Measured

120 games, five decks, sides swapped every game, Wilson 95%. Read the interval
against 50%: `arena.ts` prints a closing verdict worded for the 60% gate against
greedy, which does not apply to these matchups.

| matchup | battle phase only | with the units phase |
|---|---|---|
| planner vs baseline | 52.5% [43.6, 61.2] | **62.9% [54.0, 71.0]** |
| planner vs `weights/latest.json` | 57.1% [48.1, 65.6] | **67.5% [58.7, 75.2]** |

The first column is the lesson worth keeping. Fixing the battle phase fixes the
battle phase and does not, on its own, win more games: a battlefield is decided
by the boards both sides build, and while the units phase was still the
baseline's, the planner was only arguing over the last two or three points of a
total that had been settled before Mustra. Neither of those intervals clears 50%
and neither should have been expected to.

The second column is `board.ts` landing. Both intervals clear 50%, and the
second one is what the swap below was made on: it is the first honest claim in
this document that the planner beats the checkpoint that used to be shipped as
the opponent.

Phase 1 was not worthless, it was unmeasurable this way. What it bought shows up
on the defect it was aimed at: self-damage per cast fell from 0.30 (baseline)
and 0.45 (the shipped checkpoint) to **0.06**, and multi-spell allocation works
at all, pinned by `cast.test.ts`.

### Shipped

`src/ui/game/bot.ts` builds the opponent, and since the swap it builds this
planner rather than `weights/latest.json`. The hand-written vector is what
ships — no fit has cleared the head-to-head rule above.

Difficulty is search budget, not a temperature. The old easy setting sampled a
worse move on purpose, which reads as a bot with a twitch; easy is now a
planner that looks two placements and one cast ahead instead of six and three.
It plays each move soundly and cannot see the combinations, which is the thing
a beginner actually misses. Neither setting will cast a spell that loses it
ground, because that arithmetic does not change with depth.

**It thinks on a worker.** A battle-phase decision runs about 85 ms and the
worst measured was 1.8 s, essentially all of it `structuredClone` inside
`applyAction`. On the main thread that is a frozen board, not a slow bot, and
trimming the budget does not help — `maxLines` is not the binding constraint, so
a smaller cap buys a weaker opponent and the same stall. `botWorker.ts` is the
whole fix, and it is thirty lines only because `src/engine/` is pure: the
planner already ran headless in the simulator, and a worker is one more place
with no DOM in it. Measured in the browser afterwards: no main-thread task over
50 ms across a full bot turn.

### Commands

```bash
npm run arena -- --challenger planner --against baseline --games 200
```
```bash
npm run arena -- --challenger planner --against src/bot/weights/latest.json --games 200
```
```bash
npm run sim -- --games 400 --policy planner
```

### Cost

About 4 s a game with the planner on both seats, essentially all of it
`structuredClone` inside `applyAction` (0.17 ms a probe). The units-phase beam
costs far less than it looks, because ranking a candidate does not clone: only
the `beam` survivors of each placement are advanced through the engine, and only
a Belépő card needs a probe to be ranked at all. `beam`, `maxPlacements`,
`depth` and `maxLines` are the dials; `depth: 1` turns the cast lookahead off
and gets most of the battle-phase time back.
