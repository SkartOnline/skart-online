# Bot plan for the élvonal rules

Execution plan for the agent implementing the bot under the new rule system.
Put this file at `SkartCF/docs/bot-elvonal-plan.md` and read it together with
`CLAUDE.md` and `docs/bot-algorithm.md`. Section numbers like §5.4 refer to
`bot-algorithm.md`.

## 1. Verdict: keep the planner, change four areas

Do not rewrite the bot. The planner is model-based: Θ (`theta.ts`), the board
optimiser (`board.ts`), the threat estimate (`threat.ts`) and Γ (`gamma.ts`)
all evaluate candidates by running real actions through `applyAction` and
reading the margin through `totals()`. A rule that lives in the engine reaches
them without a second implementation. That design is exactly what a rules
change needs, and a rewrite would throw away the oracles that came with it.

What does not survive is everything the bot assumes *about* the rules instead
of asking the engine. There are four such areas, and they are the work:

| Area | Assumption that breaks | Files |
|---|---|---|
| Turn model in the Csata | One spell per turn; spellpower is a pool that depletes | `planner.ts`, `theta.ts`, `budget.ts`, `compose.ts` |
| Board search | All six units count; tiles are near-interchangeable | `compose.ts`, `board.ts`, `sim/baseline.ts` |
| Match layer | Field order is a random shuffle; nothing carries between fields | `match.ts`, `keep.ts`, new `campaign.ts` |
| Derived tables | Line of sight, adjacency, Közelharcos, pooled spellpower | `combo.ts`, `belief.ts`, `observe.ts` |

Everything else (`belief.ts` inference, `deck.ts`, `draw.ts`, `gamma.ts`,
`stats.ts`, the harnesses) needs small edits or none.

## 2. Ground rules for the executor

- The engine is the only place a rule is written. If the bot needs to know
  whether something is legal or what it is worth, it calls `legalActions`,
  `applyAction` or `totals`. Never re-derive élharcos, Testőr or tap status
  inside `src/bot/`.
- No card-specific branches. New behaviour is keyed on effect kinds and
  keywords from `schema.ts`.
- `npm test` and `npm run typecheck` after each phase. `npm run sim` only where
  a phase below says so.
- Keep each file's line endings. Commit messages in the `git log` voice.
- Each phase ends with its oracle passing. Do not start the next phase on a red
  suite.

## 3. Phase 0: the engine contract (prerequisite, separate task)

The bot cannot be built before the engine implements the rules in Appendix A.
This plan does not specify that work in full. It specifies the contract the bot
depends on. If the engine task picks different names, substitute them; the
shapes matter, the names do not.

| Bot needs | Proposed engine surface |
|---|---|
| Which unit counts | `leadOf(state, player, column)` and `countsInTotal(state, unit)` in `totaling.ts`; `boardTotal` sums only counting units |
| Who wins, including the column tie-break | `locationWinner(state)` applies 11.3; add `columnsAhead(state, player)` |
| Tap casting | `unit.tapped: boolean` replaces `unit.spellSpent`; `canCast` is false when tapped |
| Chains | After a `castSpell` resolves the turn stays with the caster. `legalActions` then offers further `castSpell` for that caster only, `finishChannel` if a Mesteri is pending, and a new `endChain` action. `state.chain = { casterUid, school, spent }` |
| No line of sight | `grid.ts` loses the path check; targeting is range plus Testőr |
| Piles | `playUnit` onto an occupied slot is legal when both are the same-named Falka card |
| Retreat | New action `retreat` in the Gyülekezés |
| Campaign choices | Prompt kinds in `prompts.ts`: `pickNextField`, `pickVeteran`, `pickGarrison`, `placeVeteran`, `callGarrison` |
| Birtok | `location.birtok` effect list plus a one-shot action `invokeBirtok` |
| Public information | `redact` stops hiding field order; `tapped`, veterans and garrisons are public |

Phase 0 is done when `rulebook.test.ts` pins the new numbered rules and the
existing bot compiles against the new types, even if its tests fail.

## 4. Phase 1: make the existing bot run on the new engine

Goal: a legal, weak bot. No new judgement yet.

1. **One margin function.** `theta.ts:margin()` already reads `totals()`. Route
   the direct `boardTotal(a) − boardTotal(b)` sites through it: `board.ts`
   lines 264 and 417, `planner.ts` line 511, and every site in
   `sim/baseline.ts` and `replay.ts`.
2. **See the tie-break.** Make `margin()` return
   `sum difference + 0.25 × sign(columnsAhead difference)`. A quarter point
   never outranks a real point and lets the bot prefer the board that wins an
   equal sum.
3. **Spellpower model.** In `budget.ts`, replace remaining-pool arithmetic with
   "an untapped unit whose printed varázserő covers the cost". Delete every
   read of `spellSpent`.
4. **Delete line-of-sight reasoning.** Remove it from `compose.ts:reach`,
   `combo.ts` (the `reach` edge class and the LOS readers of `alive` and
   `slot`), `observe.ts` and comments in `board.ts`. Where a file computed
   reachability itself, ask `legalActions` instead.
5. **Unknown actions.** In `Planner.choose` and `sim/baseline.ts`, route
   `endChain`, `retreat`, `invokeBirtok` and the five new prompts to a default:
   end the chain when Θ is empty, never retreat, never invoke, first legal
   option for prompts. Phases 2 to 4 replace each default.
6. **Freeze a new reference.** `legacy.ts` holds the pre-review planner under
   the old rules and cannot play the new game. Replace its contents with the
   Phase 1 planner and say so in its header. "Beats legacy" restarts here.

Oracle: 200 mirror games per deck at `--strength fast` finish with no illegal
action and no thrown error. Win rate is not judged in this phase.

## 5. Phase 2: the Csata under chains and tapping

This is the largest change in behaviour, and most of §5.4 of the old design is
now wrong.

### What changes in the problem

- The unit of a turn is a **caster's chain**: an ordered list of spells from
  one school, total cost within that unit's varázserő, optionally closed by a
  pending Mesteri. After the turn the caster is tapped for the battle.
- A setup and its payoff cast by the same unit resolve with no reply in
  between. The old rule "setup late or not at all" applies only to bundles that
  span two casters.
- Capacity is use-it-or-lose-it. Unused varázserő on a caster that has cast is
  gone, so the decision is which subset of the hand this caster fires now.
- Order still does not change the final sum (§5.2). It changes what the
  opponent can answer between turns, which is now per caster.

### Work items

1. **`theta.ts`: search by caster.** The line search already steps through
   `applyAction`, so legality is correct once the engine offers chain
   continuations. Change the budget split from one share per spell to one share
   per untapped caster, and include `endChain` as a branch. `maxDepth` counts
   casts; raise the default from its current value by the largest chain the
   card set allows (a varázserő 8 unit with one-cost spells).
2. **Outcome dedup stays** and matters more: two orders of the same chain that
   leave the same board are one plan.
3. **`Plan` gains turn structure.** Replace the flat `casts: Cast[]` with
   `turns: { casterUid, casts: Cast[] }[]`. `applyPlan` and `thetaWithout`
   follow.
4. **`planner.ts`: play one caster's chain, then re-plan.** Today the planner
   plays the first cast and queues that cast's picks. Extend the queue to the
   rest of the first turn's chain. Re-plan between chain casts only if the
   board differs from what the plan predicted (a prompt or a random effect);
   otherwise continue the queue, then `endChain`.
5. **Scheduling across casters** replaces §5.4. Rank the turns of the chosen
   plan and play the first:
   - a caster the opponent can kill or silence this turn goes first, measured
     as `Θ(me) − Θ(me without that caster)` against their threat on it;
   - a caster whose chain kills their untapped caster goes before one that
     only moves the margin;
   - a caster protected by a Testőr can wait, because it is not answerable;
   - with no pressure either way, the chain that reveals the least goes first.
6. **Mesteri.** Starting one still costs a whole turn. The finishing turn may
   now carry a chain in front of it, and the Mesteri's cost counts against the
   same varázserő. When evaluating "start a Mesteri", Θ must reserve that
   capacity on a caster that will still be untapped next turn.
7. **`castPotential`** in the board guide (§13 defect 3) was "largest spell in
   hand this unit could pay for". Make it the best chain: a 0/1 knapsack of
   hand spells of one school within the unit's varázserő, valued by cost.
8. **Wasted casts.** `planscan.ts` counts per cast. Count per chain as well,
   and report both.

Oracles:
- `theta.oracle.test.ts` regenerated under the new rules: Θ at shipped settings
  equals exhaustive search on all 600 small boards.
- New cases in `theta.test.ts`, arithmetic written out: Hátbaszúrás then
  Kegyelemdöfés from one Zsivány of varázserő 4 is one turn; the same pair
  split across two casters is two turns and is priced lower when the opponent
  holds removal; a tapped caster contributes 0 to Θ.
- `npm run combos`: record the new candidate distribution. If p99 candidates
  per decision exceeds 150, cut with the per-caster budget before touching
  beam widths.

## 6. Phase 3: the Gyülekezés under élharcos

### What changes in the problem

- At most three units count, plus Távolsági units in the back. A composition
  is three leaders and up to three supports, not six bodies.
- Tiles are no longer near-interchangeable. Front or back decides whether a
  unit counts, and the column decides what it faces and what stands behind it.
- A support has a second value: it becomes the élharcos if the unit in front
  dies. That is insurance against removal.

### Work items

1. **`compose.ts`: rank through the engine only.** The header lists "power it
   will actually have" as criterion 1, taken from the projection. Verify no
   path sums printed power. A six-body composition must not outrank a
   three-body one with the same leaders.
2. **Arrangement generation by role.** For a fixed composition, generate
   arrangements as: choose which units lead, assign leaders to columns, assign
   each support to a column, then order placements for Belépő. Canonicalise
   columns: two columns are interchangeable when the opposing column and any
   terrain or facing text are identical, so generate one of them.
3. **Insurance is already priced, so test that it is.** `scoreBoard` subtracts
   a share of their Θ (§13 defect 4). A support behind a fragile leader lowers
   their Θ, because killing the leader now removes less. No new term. Add the
   test in the oracle list below.
4. **Piles.** Add "play onto an existing same-named Falka unit" to the
   placement candidates in `board.ts`. The exposure term prices the risk of
   one removal spell taking the whole pile.
5. **Bounds.** `sim/baseline.ts:theoreticalMax` and `planner.ts:securedBoard`
   and `contestable` bound what the opponent can still add from their
   remaining cap. Under élharcos the bound is the best assignment of that cap
   to columns where their leader can still be replaced or buffed, which is
   much tighter than the cap itself. Rewrite all three on one shared helper.
6. **Hiding** stays a wrapper on the chosen board (§6.3). One change to the
   default: a hidden leader's power is bracketed by the cap, a hidden support
   is not informative at all, so prefer hiding a caster in the back row.
7. **Retreat.** Add the third option to `gatheringVerdict`, in the same
   currency as the other two:
   - continue: `winChance × fieldValue − price of the cards still to commit`;
   - kész: `winChance now × fieldValue + veteran value if lost`;
   - retreat: `0 + hand value of the returned units − veteran value`.
   Hand value comes from `keep.ts`: the improvement in the best hand of five
   once the returned units are added and the excess is tossed. Retreat is never
   chosen on a `decisiveField`.

Oracles:
- `board.test.ts`: beam equals exhaustive placement on constrained boards with
  mixed leaders and supports, including under a cap.
- New: with an enemy hand holding a kill spell, Tartalékos behind a 3-power
  leader scores above the same board with the back slot empty. With an empty
  enemy hand the two score equal apart from cost.
- New: three Patkány in hand produce a pile when the opponent shows no
  removal-capable caster, and three separate bodies when one Fojtás-range
  caster is untapped and facing.
- `npm run planner`: the never-stops-early reference still loses to the
  planner with the Wilson lower bound above 50.

## 7. Phase 4: the campaign layer

New file `src/bot/campaign.ts`. `match.ts` keeps `matchOdds` for A Zóna and the
terminal cases and loses its assumption of a random order.

1. **Exact DP over chosen order.** State: my wins, their wins, the set of
   remaining fields, who picks next. With six fields that is at most 64 sets
   times a handful of scores. The picker takes the field that maximises their
   own match odds, so it is a small minimax. Input: `p[field]`, my win
   probability on each remaining field.
2. **`p[field]`, first version.** A table `src/bot/fieldodds.json` keyed by my
   deck, their deck and field, built from a balance report by a new
   `npm run fieldodds` script. Unknown pair: 0.5, shifted by who opens the
   field. This is the `p_i` input §8 said the match layer never had.
3. **`pickNextField`.** Answer with the DP's argmax.
4. **`fieldValue` and `cardPrice`** now read the DP instead of assuming 0.5
   everywhere. Leave `secure` off: §14's reason (Θ of the opponent is a lower
   bound) is unchanged by these rules.
5. **`pickVeteran` (loser).** For each survivor and each field the DP might
   pick, project `bestBoard` with that unit pre-placed, cheap tier only, no Θ.
   Choose the pair with the best margin and answer the two prompts
   consistently. A unit whose value is its Belépő scores at its body, because
   the Belépő does not fire again.
6. **`pickGarrison` (winner).** Bank the survivor with the highest projected
   leader value at the remaining caps: power plus rings plus the exit ring,
   among units whose cost fits at least one remaining field.
7. **`callGarrison`.** Call when the gain in `winChance × fieldValue` on this
   field is at least the best such gain expected on any later field, and
   always on the last field where it fits.
8. **`invokeBirtok`.** Birtok lines are one-shot and data-driven. Value an
   invocation as `score after − score before`, through the engine. Invoke when
   that value times `fieldValue` beats the same threshold as `callGarrison`,
   and always when no later field can use it.
9. **Leszerelés.** `keep.ts:tossPlan` already tosses. Check it handles a hand
   over its limit after a retreat, and that `capsAhead` no longer treats the
   order as unknown.

Oracles:
- `campaign.test.ts`: the DP agrees with a 200 000-trial Monte Carlo of the
  same picking policy on six scorelines, including voided fields.
- With `p` uniform at 0.5 the DP returns the old `matchOdds` values.
- Mirror, fields won by position in the six: no cliff on fields 5 and 6.

## 8. Phase 5: belief, harnesses, UI

1. **`belief.ts`.** `payloadOdds` asks whether an untapped unit can pay, not
   whether pool remains. A retreat puts known cards back in their hand: add
   them to the certain part of the belief in `seenCards`.
2. **`observe.ts`.** Expose `tapped`, veterans and garrisons. Drop the hidden
   field order. `belief.test.ts` must still pin the mask invariant.
3. **`sim/run.ts` and `report.ts`.** Snapshots record which units counted and
   the column result. `run.test.ts` pins them against the engine's totals.
4. **`ui/game/bot.ts`, `botWorker.ts`.** A turn can now be several actions.
   Budget the wall clock per turn and split it across the chain.
5. **Docs.** Add a §15 to `bot-algorithm.md` recording what the new rules
   changed and what each oracle measured. Update `CLAUDE.md`'s task table.

## 9. Acceptance

Run once, at the end, in the background:

| Check | Target |
|---|---|
| `npm test`, `npm run typecheck` | Green |
| 500 sim games across all decks | No illegal action, no exception |
| Mirror vs `sim/baseline.ts`, 16 games × all decks | Wilson lower bound above 50% |
| Mirror vs the Phase 1 freeze | Wilson lower bound above 50% |
| Wasted casts (`npm run planner`) | At or below 15% |
| Decision time on the game screen | p99 under the per-turn budget |

A cross-deck win rate is a card-set number and is not an acceptance check.

## 10. Risks

- **Chain branching.** A high-varázserő caster with a hand of one-cost spells
  is the worst case for Θ. The per-caster budget and outcome dedup are the
  controls; measure with `npm run combos` before tuning anything.
- **Rules still moving.** Birtok texts, pile rulings and the garrison are not
  final. All of them sit behind the engine contract, so a change is engine
  data or one prompt handler, and the bot's valuation follows.
- **The reference opponent.** §13 showed that a weak baseline hides play
  quality. Update `sim/baseline.ts` for the new rules in Phase 3 and 4, or
  every later number flatters the planner.

## Appendix A: rule deltas the engine must implement

Source: the "Draft v2" tab of the rules document, with two later amendments.
Export that tab into `docs/szabaly-teljes.md` as Phase 0's first step.

1. **Élharcos.** Per column, the front unit counts; if the front slot is empty
   the back unit counts. Other units are supports and add no power.
2. **Összesítés.** Sum of élharcosok plus Távolsági units counting from the
   back. Equal sums: whoever is stronger in more columns wins; still equal,
   nobody.
3. **Keywords.** Közelharcos deleted. Távolsági counts from the back row.
   Testőr in the front row makes the unit behind it untargetable by enemy
   spells. Falka units stack on a same-named unit as one pile: summed base
   power, one text, dies as one. Defaults for the open rulings: a power
   modifier hits a pile once, a pile may form on a veteran, no size limit.
4. **Line of sight** deleted. Range alone.
5. **Casting.** A caster pays if its printed varázserő covers the cost. It may
   chain several spells of one school in a turn within that number, may close
   the chain by finishing a pending Mesteri, and is tapped afterwards.
6. **Field order.** First field random, the rest face up; the loser of each
   battle picks the next. On a void, the player who did not bring it picks.
7. **Retreat.** In the Gyülekezés, instead of placing or kész: lose the field
   at once, surviving units return to hand, excess is tossed at Leszerelés.
8. **Veteran and helyőrség.** Loser may send one survivor to the next battle.
   Winner may bank one survivor on the battlefield card and call it into any
   later battle with one ring. Both keep rings, arrive face up before the
   Gyülekezés, count against the cap, and do not re-fire a Belépő. On a void
   both players may take a veteran.
9. **Amendment, adjacency.** Buffs that read "szomszédos szövetséges" become
   army-wide over élharcosok (Kovács, Lényidomár, Maffiavezér and the matching
   spells). Cards with a specific positional identity (Kopja, Bol'Jin,
   Bérgyilkos, Sir Werdzsell, Vérfarkas, Azman) keep one and are retouched in
   data. This is card data only.
10. **Amendment, Birtok.** Each battlefield has a small one-shot effect its
    holder may invoke once. Assumption to confirm with the designer: it can be
    invoked only while a helyőrség stands on the card.
