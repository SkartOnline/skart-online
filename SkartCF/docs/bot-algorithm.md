# The bot algorithm — layered plan

A design document, not a description. Nothing here is implemented. It is the
answer to "what should the bot's algorithm actually be", worked out from the
rulebook rather than from the shape of the current learner, and it supersedes
the "Open work" list in `bot.md` where the two disagree.

`bot.md` still describes what exists today: a linear value function over 103
features, picking moves by one-ply afterstate evaluation. That design is not
extended here. It is replaced, except for the two places at the very bottom
where learning is genuinely the right tool.

Rules are cited by number throughout. `szabaly-teljes.md` decides.

---

## 0. The claim in one paragraph

Skart decomposes cleanly, and the decomposition is worth more than a bigger
model. A battlefield is nearly self-contained; the battle phase is a planning
problem over a small set of interacting effects, not a tree search; the
gathering phase is two alternating best-responses under an irrevocable stop; and
the match is a scoreboard small enough to solve exactly. Every layer trades in
one currency, and one function — **score** — is called by all of them. Build
score properly and most of the remaining layers are two-line comparisons.

---

## 1. The currency

Everything is denominated in **match win probability**. A board is worth what it
does to it. A card in hand is worth what it does to it. This is what makes
"win this battlefield" and "keep this card for the next one" comparable at all.

Two derived quantities do the actual work, and both come out of the match layer
(§8) as finite differences:

| Symbol | Meaning |
|---|---|
| `V_i` | marginal match value of winning battlefield *i* |
| `λ` | shadow price of a resource — a card, a caster, a point of deck depth |

`V_i` is not constant. The fourth win is worth everything, a fifth is worth
nothing (1.3.3), and at 1–3 down you need both remaining fields, which makes
high-variance lines correct. Risk posture is the derivative of the match DP, not
a tuning knob.

---

## 2. Layer map

Control flows down, value flows up.

| Layer | Decides | Consumes | Produces |
|---|---|---|---|
| **L0 Match** (§8) | which battlefields to contest, what to spend | `p_i(c)` cost curves | `V_i`, `λ` |
| **L1 Battlefield** | stance for this field, target margin | `V_i`, `λ`, score | `p_i(c)` |
| **L2a Gyülekezés** (§6) | place / hide / kész | score, belief | a board |
| **L2b Csata** (§5) | plan, schedule, kész | score, belief | a final margin |
| **L2c Leszerelés** (§9) | what to discard | `λ`, deck state | next hand |
| **Score** (§3) | — | board, hand, belief | a number in power units |
| **Belief** (§7) | — | public record | a distribution over their hand |

Score and belief are not layers, they are services every layer calls.

---

## 3. Score — the function everything else calls

> `score(board, hand, belief) = realised power + Θ`

`realised power` is the 11.1 sum as the board stands right now.

`Θ` is the value of the **best plan still available** from that board and that
hand — the margin the side could still move if the battle phase ran out from
here. It is measured in power, because the plan's output is measured in power.

This is the "score instead of power" idea, made concrete. Everything the design
wanted from it falls out:

- A Feketemágus 8 holding no black spells prices at his body, because he adds
  nothing to `Θ`.
- The same mage holding a bomb in range and line of sight prices at the bomb.
- A second copy of a big spell prices at nearly nothing, because one caster pays
  once and spellpower does not pool (8.3.4, 8.3.5, 8.3.6).
- A board that ate its cost cap and shows little power is not weak; it bought
  `Θ`.

### Built, and what it cost

`src/bot/theta.ts`. Θ enumerates plans and runs each one through `applyAction`,
so range, line of sight, target filters, immunity, spellpower depletion, death
sweeps and the Mesteri two-turn commitment are right by construction rather than
by a second implementation nobody keeps in step. The probe puts the opponent in
the *finished* state rather than removing them, which is a position the rules
actually produce (8.1.3), so it is a legal game being read rather than a doctored
one.

Two things make it affordable. Candidates are deduplicated **by outcome**: two
targets that leave the same board are one plan wearing different clothes, and on
a crowded board that is most of the branching. And each spell in hand gets its
own share of the node budget, so the plan cannot depend on which card happened
to sit first.

The measured cost is **~100 ms per call** at the shipped budget, against the
3-second move budget the app allows. The full curve is in `theta.ts`; the short
version is that 800 nodes agrees with 4000 on 97.2% of decisions and the last
2.8% costs four times the time. `FAST_THETA` (~34 ms, 90.5% agreement) is for
training and the balance runner, which call it hundreds of thousands of times.

What it buys, on the cases greedy cannot see:

| board | best single cast | Θ |
|---|---|---|
| two Explars against a 2-power body | 0 | 2 |
| Senyvesztés + Káoszkolera against a 3-power archer | 1 | 3 |

Both are in `theta.test.ts` with the arithmetic written out. The first is the
whole argument in one line: 9.5.2 means a damage token that does not kill moves
no total at all, so one Explar is worth *exactly* nothing and two are worth a
unit.

### Why `Θ` and not a weighted spellpower feature

Spellpower and power have no common scale. Multiply every spell cost and every
unit's spellpower by ten and the game is unchanged, but any hand-weighted
"power + k · spellpower" heuristic changes completely. `Θ` is immune, because it
is mediated by what the spellpower can actually pay for.

The same argument gives the value of removing a caster, without a weight:

> `value(killing caster c) = Θ(their board, their hand) − Θ(their board − c, their hand)`

in power units. Disabling works identically, since 10.7.1 shuts off spellpower
too.

### Score is asymmetric in information, but neither side is exact

`Θ(mine)` reads a hand that is known; `Θ(theirs)` reads one that is not. That is a
real asymmetry and the stack must keep it.

It is not the same as `Θ(mine)` being exact. The *value* of my plan depends on
their hand too: a Mesteri removal is worth its full swing if they hold nothing
to answer it and close to nothing if they hold a protection spell, and I
usually cannot tell which. So `Θ(mine)` is an expectation over their possible
answers, and only its *inputs* are certain.

That gives information-gathering a price the rest of the stack can read.
Inkvizitor and the other cards that look at a hand do not add power; they
narrow the distribution `Θ(mine)` is averaged over, which is worth exactly the
variance they remove. That is also the honest way to value a peek: not as a
card advantage, but as a reduction in how wrong the plan can be.

---

## 4. The combo graph

The central mechanical problem: the value of a cast is a property of the
**bundle**, not of the cast. The −3 on a 6-power unit is the correct target only
because a "destroy everything at 3 or below" exists in the same hand. Any
generator that scores casts individually deletes exactly the setup moves that
make combos work — which is the failure `bot.md` already records for
Infiltráció → Hátbaszúrás.

But most pairs of spells do not interact at all. Buffing your own unit and then
damaging theirs is two independent additions, not a combo. Enumerating all
bundles is wasteful; enumerating none is wrong. So enumerate the ones that
interact, and derive which those are.

### Derived, not hand-listed

Every effect kind in `schema.ts` already declares what it reads. This is an
existing invariant — "every effect declares which accessor it reads, taken from
the card text" — and it is exactly the metadata needed. `thresholdAoe` and
`massDestroy` carry a `stat` field with options `power` / `basePower`; targeting
carries `side`; filters carry the quantity they test.

So build, once, a table of `writes` and `reads` per kind over these quantities:

| Quantity | Written by (examples) | Read by (examples) |
|---|---|---|
| `power` | `modifyPower`, `aura`, `countBonus`, `rowBonus`, `grantRing`, `perCost`, `strongestPenalty`, `suppressPositional` | `thresholdAoe`/`massDestroy` with `stat: power`, power filters, `damage` lethality |
| `basePower` | `setPower`, `powerOverride`, `transform` (9.1.2) | `thresholdAoe`/`massDestroy` with `stat: basePower`, basePower filters |
| `damage` | `damage`, `damageCap` | lethality check (9.6.1) |
| `alive` | `destroy`, `massDestroy`, `devour`, `duel`, `returnToHand`, `bounceToDeckBottom` | `aura` sources, `countBonus`, `rowBonus`, LOS (4.8.3), spellpower availability |
| `slot` | `move`, `advance`, `portal`, `swapWithAdjacent`, `summon`, `revive` | range (4.7), LOS (4.8), adjacency (4.2), positional keywords (9.3), `rowBonus` |
| `spellpower` | `modifySpellpower`, `schoolSpellpowerBonus`, `banCasting`, `lock`, `freeCasts`, `spellCostMod` | castability (8.3.3) |
| `attachments` | `attach`, `clearPlaced`, `moveAttachment` | 10.6.2 duration, whatever the attached card grants |
| `targetability` | `grantImmunity`, `selfGrant`, `fizzleShield`, `redirectSpells` | legality (8.4.2.5–8.4.2.7) |

Then:

> **A and B are in the same bundle iff `writes(A) ∩ reads(B) ≠ ∅` and their
> target scopes can overlap** (same side, both reachable).

This produces a static adjacency matrix over kinds, refined at runtime by
side and reachability. Connected components of the castable set are the bundles.
Everything else is scored additively.

The precision this buys is real, and it is the kind of thing a hand-written
heuristic never gets right:

- `modifyPower` writes `power`. A `massDestroy` declared with `stat: basePower`
  reads `basePower`. **They do not combo.** No amount of −X sets up that sweep.
- The same `modifyPower` combos with a `thresholdAoe` declared `stat: power`.
- `move` combos with almost everything positional, which is why movement looks
  worthless standalone and is not.
- `destroy` on an aura source combos with anything reading `power`, because
  10.4.4 kills the aura and 9.2.4 recomputes immediately.

The matrix is derived from `schema.ts`, so a new effect kind joins the combo
search for free — same contract as the editor and the validator. No card-specific
branches anywhere, per the standing invariant.

---

## 5. Csata — plan, schedule, re-plan

Not a search with pruning. Three steps, repeated every turn.

### 5.1 Why not tree search

Branching is (spells × legal casters × legal targets × destinations), four
figures per ply in bad cases, over 8–12 plies. Worse, it is hidden-information:
their hand is unknown, so a determinized tree would need reshuffling at every
node and would still suffer strategy fusion. And the deep structure of the phase
does not need it — 8.2.4 means nothing happens between turns, so the board is
fully known at the start of each of your turns and there is no interleaving to
resolve.

### 5.2 Plan

**Order does not matter to the final sum.** 11.1 reads current power at
scoring, 9.2.4 recomputes continuously, and 9.5.2 keeps damage out of the total.
Order matters only through deaths and through what the opponent gets to
interfere with. So plan over **outcomes** — which units end up dead, what deltas
sit on the survivors — and then check reachability against spellpower budgets,
range, line of sight, and turn count. Outcome space is bounded by subsets of at
most six enemy units. Move space is not.

Generation is **backward chaining from thresholds**, because thresholds are
where value is discontinuous:

1. Collect every threshold in play. Death (9.6.1: power at 0, or damage reaching
   current power), every `atMost` cutoff in hand, every target filter (8.4.2.7),
   every positional condition.
2. For each threshold, ask what would have to change to cross it, and which
   castable effects write that quantity — the combo graph answers this directly.
3. Enumerate over those chains — but **not** as subsets of one merged
   component, which is where the first draft of this section was wrong. See
   below.

Non-threshold targets still matter for raw margin. For those, take the maximum
and stop; there is nothing combinatorial there.

### 5.2.1 Two shapes, because the two edge classes are different relations

This was measured (`npm run combos`) rather than assumed, and the measurement
corrected the design. `value` edges and `enable` edges do not enumerate the same
way:

- A **`value` component is a genuine n-way interaction.** −3, a sweep and a
  damage spell all reading each other's arithmetic means any subset of them can
  be the right bundle, so it costs `2^n` — affordable only because `n` stays
  tiny. Measured over 100 games: largest value component is 1 at the median, 2
  at p95, 6 at the worst decision seen.
- An **`enable` edge is not n-way.** A movement spell that brings eight
  different spells into range does not make an eight-card combo; it makes eight
  two-card setups. Enumerating subsets there counts a blob that is not one, and
  it was what pushed the worst case to `2^11`. Walk ordered setup → payoff
  pairs instead and the cost is linear in the edges.

With that split, what the generator emits per battle-phase decision, over 400
games and 12 114 decisions:

| | mean | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| value subsets | 2.8 | 2 | 9 | 16 | 68 |
| enable pairs | 2.6 | 0 | 14 | 30 | 48 |
| **candidates** | **5.5** | **2** | **23** | **41** | **108** |

Against a 3-second per-move budget, 108 candidates is about 28 ms each, which
is a whole `structuredClone` and a re-total with room to spare. §5.2 holds.

The tail is stable rather than undersampled: at 100 games the same figures were
2 / 22 / 36 / 108, and quadrupling the sample moved p99 by five and the maximum
not at all. A worst case that does not grow with sampling is a structural
ceiling — six slots a side, seven cards in hand, one school per caster — not a
number waiting to surprise the planner.

Two other numbers from the same scan, both load-bearing elsewhere:

- **35% of battle-phase decisions have nothing castable at all**, and another
  12% have exactly one spell. Only about half of all turns (52.7%) involve
  choosing between spells; the rest are a target choice or a *kész*. The planner
  is cheaper than the per-decision figures suggest, and the phase is shorter
  than it looks.
- **Pairwise density over the spell set**: `value` 14.7%, `+enable` 32.4%,
  `+indirect` 38.2%, everything 56.0%. The `reach` class alone — a kill opening
  a line of sight, a caster that has to still be standing — takes it from 38% to
  56% and collapses the graph into one blob. It is real and it is off by
  default: the planner covers it by re-planning every turn (§5.5), which 8.2.4
  makes free.

### 5.3 Choose against the *required* margin, not the expected one

The battlefield payoff is a threshold, not a magnitude (1.3.1: the larger sum
wins, by any amount). So the plan chooser maximises `P(final margin > 0)`, and
the deficit determines risk:

- They lead by 2 and have finished casting → any bundle worth 3 wins. Take the
  safe one; a −3 anywhere on the board is enough.
- They lead by 8 and you can reach 5 safely or 12 at 40% → **take the 40%.** The
  safe line loses with certainty.

This is why a setup cast is never simply "zero standalone value" — a −3 is
always at least −3, and whether that is enough is a question about the deficit,
not about the card. What is true is that a setup cast is **sub-additive alone**:
it is worth its face value standalone and much more inside its bundle, and the
gap is the risk you are taking when the payoff can be disrupted.

Against the belief this is a small matrix game per turn — five of your plans
against five of their plausible counter-plans — resolved by expectation or by
max-min depending on where `V_i` puts you on risk. Not a tree.

### 5.4 Schedule

Given a chosen bundle, the ordering rules, which mostly agree with each other:

- **Disruptable first.** A cast whose preconditions the opponent can cheaply
  break — killable caster, killable target, breakable line of sight — goes
  early. Killing their caster is usually the most disruptive single act
  available and the least likely to still be available later.
- **Setup late, or not at all.** Play the setup half of a bundle only when the
  payoff half is itself hard to disrupt, or when the deficit means you must.
- **Information late.** 8.4.1 forces naming caster and target at cast, so every
  cast fully reveals one card. Delay the ones that telegraph the bundle.
- **Movement usually costs a whole turn** and moves the margin by zero, so it
  normally has to buy more than a turn, and normally should not open the phase.
  This is a rule for the generator's ordering, not a rule of the game: some
  movement is worth power on its own, because the destination is worth power.
  Vízköpő moving into an empty row, a Melee unit stepping into the front row, a
  Távolsági one stepping back — those are margin moves and the generator must
  price them as such. The combo graph already says so: `move` writes `slot`, and
  `rowBonus`, positional keywords and `countBonus` all read it.

### 5.5 Re-plan every turn

Discard the plan and rebuild it after each of their casts. The plan is a way of
choosing *this* move well, not a commitment. Same discipline as gyülekezés.

### 5.6 Mesteri is the one real commitment

8.6 makes it two turns: face down in focus, then a forced completion that costs
an extra discarded spell (8.6.4) and locks the whole intervening turn (8.6.3).
It must be completed even when it has become worthless (8.6.6), and the phase
cannot end while any focus is occupied (8.6.8).

So a Mesteri bundle is evaluated as *"am I still ahead after they get a free
turn aimed at me"*. Note the caster is named at **completion** (8.6.5), not at
commitment, so killing one caster does not fizzle it if another legal caster
remains. The actual counters are `banCasting`, stripping every legal
caster/target, or emptying the spell hand so 8.6.7 bins it.

---

## 6. Gyülekezés — alternating best responses

### 6.1 The board optimiser is a best response, not a knapsack

Given a cost cap, a hand, and **the opponent's current board**, find the
placement maximising score. The opponent's board is an input because line of
sight is real (4.8) and only enemy units block (4.8.4), asymmetrically (4.8.6):
their bodies decide which of your casters can see anything, which decides `Θ`,
which is half of score. Slot interactions (4.2 adjacency, 9.3 positional
keywords, `rowBonus`, `countBonus`) make it a small combinatorial assignment
over six slots — exact subset DP or a beam, and cheap either way.

This is the one piece that should be plain code with a brute-force oracle test.
It is fully determined, it is small, and learning it would be waste.

**Built**: `src/bot/board.ts`. One thing the sketch above got wrong — it is not
an *assignment* over six tiles. Belépő fires as each unit lands (6.3.6), so the
same six cards in two orders are two different boards, and the search is over
placement **sequences**. Candidates are therefore built out of real `playUnit`
actions, which also gets the cap, the blocked tiles and the placement rules for
free.

Evaluating a candidate means projecting it into the battle it would become:
declare both sides finished and let the engine run the Mustra — the reveal, the
owed Belépő, the Mustra abilities, in 7.5's tile order — then call `score` on
the result. Nothing reimplements the Mustra.

Two tiers, because score is too slow to call at every node — this is §12's
"cached cheap Θ for interior nodes, the full one at leaves", and it turned out
to be needed at the first layer that sits on Θ rather than later:

| tier | evaluator | where |
|---|---|---|
| beam | realised margin, no Θ | every node |
| finalists | `score` = margin + Θ | top `finalists` candidates |

The cheap tier cannot see that a caster is worth more than its body, so the
finalist tier is what puts casters back. The test that pins this is the one
where the two tiers disagree: a cap of 15 forcing a choice between Charon
(power 9, no spellpower — margin 9, Θ 0) and Celebrant (power 7, Mágus 10 with
a Lánglándzsa behind it — margin 7, Θ 3). Realised margin ranks them the wrong
way round; score does not, and told to trust the beam alone the search takes
Charon and scores a point less.

**The cap on this**: the beam is guided by a number that is blind to the very
thing the finalists are chosen for. A caster board that ranks below
`beamWidth` on realised margin never reaches the finalists at all. On the
hands measured so far that has not bitten, but it is the obvious place for
this to be wrong, and the fix — guiding with a cheap Θ proxy such as castable
spellpower — is unbuilt.

### 6.2 Stopping

The hardest decision in the game and the current bot's worst failure
(`bot.md` limitation 1: plays to the wrong target, stops too early).

The rule never looks at power totals. It compares

> `E[margin after the battle phase | kész now]` against
> `E[margin after the battle phase | one more unit]`

with both sides evaluated through score, i.e. through `Θ`. That is what
"stopping at 14 against a visible 15 is fine if you hold three spells" actually
means: `Θ(mine) − Θ(theirs) ≥ 1`, computed against the belief, not counted on
fingers.

Two rules shape the decision and both are easy to get wrong:

- **6.6.3 makes kész final**, and it tells them what number to beat.
- **1.5.3 keeps the spent budget private**, because hidden units' costs count
  (6.5.4). So it does *not* tell them what you can still afford, and it does not
  tell them what you can still cast.

And the read on their board must be conditional, never marginal. A board that
looks weak is either a concede or a trap, and the discriminating statistic is
**cost committed versus power shown**, since casters are priced separately from
bodies by design:

| Visible cost | Visible power | Read |
|---|---|---|
| low | low | concede — they are saving material |
| **high** | **low** | **payload** — they bought `Θ` and intend to turn it |
| high | high | honest board |

Same for an early kész: cheap and early is a concede, expensive and early is
someone waiting for you to lowball. Carry both hypotheses; the responses are
opposite and the cost of guessing wrong is asymmetric.

### 6.3 Hiding is a wrapper on an already-chosen board

Choose the board first, then choose which of those placements to flip face down
and pay 6.5.2 with the worst unit card in hand. It is not a search dimension.

**Hide the card that most reduces their ability to estimate your score.** Which
means hide a caster, not a body, and the reason is asymmetric bounding:

- The cap is public, and the cost of your visible units is public, so they can
  bracket your **hidden power** from the budget you have left.
- Nothing brackets your **hidden spellpower**, because cost and spellpower are
  deliberately decoupled in the cost curve.

So hiding a body conceals a quantity they can already estimate; hiding a caster
conceals `Θ`, which they cannot. The 6.5.6 cost — no statics or auras carried or
received while face down — is close to free, because gathering-phase power
barely interacts with anything. Note 6.5.9: a battlefield can raise the price, so
this is a per-field calculation, not a constant.

That is the default, not a rule. What is face down is *unknown*, not
mislabelled: a body hidden where a caster would be expected reads as a caster,
and a caster hidden where nobody would spend the discard reads as a body. The
opponent is estimating a distribution, and the card put under it is a free
choice — which makes hiding the most flexible tool in the gathering phase and
the one place a genuinely mixed strategy pays. So the criterion above sets the
*prior*; the mixing over it belongs with the other equilibrium work (§10).

4.8.7 (hidden units block line of sight) is vestigial in practice: everything is
revealed at Mustra (7.2) and nothing casts before then (5.3).

---

## 7. Belief

Against a known deck this is cheap and strong, and the current bot has none of
it.

**Base.** Their hand is a draw from `deck − graveyard − revealed`.
Hypergeometric, exactly — and the deck list is an input the bot is **given**.

3.1 hides deck composition at a normal table, but that is a rule about two
humans, not about this. A bot that has to discover the deck plays a duller game
than one that knows it, and competitive play knows it anyway: lists are public
and rounds repeat. So `knownDeck` is the intended mode, and it is exact from the
first turn.

`src/bot/belief.ts` keeps an inference path for when the list is not supplied,
because that is what a human across the table is doing and what runs against an
unregistered deck. Two stages: **which deck are they playing** — every card
shown is a card their deck contains, and 14.2 caps the copies, which collapses
the field fast — then **what is left in it**. Failing that, a flat pool prior
rather than a deck it has never met.

Hard elimination was the first attempt at the inference and it was too brittle:
cards genuinely change hands (`stealCard`, `handSwap`, and 12.2 sending a unit
to *its owner's* graveyard), so one stolen card ruled out every archetype at
once. Calibration caught it — 14.7% of observations falling back to the pool
prior for no reason. Counting *misfits* fixed it, and the inference now pins the
deck on 100% of observations, which is why supplying the list scores identically
here: the two modes only come apart early, before anything has been revealed.

**Resolution: school payload, not cards.** The quantity that matters is
`P(they can cast school S at level ≥ n, in range, with line of sight)`. Model
that, not individual card identities. Decks are built so casters and spells
match, so a Druida on their board raises the probability that they hold Druida
spells well above the marginal rate — from deck composition *and* from the play.

Built as `payloadOdds`, and it answers **"can they still cast"** rather than
"do they hold one" — the two come apart the moment a player closes the battle
phase (8.7.3), and every caller wants the threat. Range and sight are left to
the caller, because they depend on which unit of mine is asking; this is the
ceiling.

**Measured.** `npm run belief` predicts from one seat's observation and checks
against the hand that seat cannot see. Over 20 games and 1 328 predictions:

| | Brier |
|---|---|
| always guessing the base rate (0.58) | 0.243 |
| hard elimination, ignoring `spellsClosed` | 0.079 |
| misfit matching, ignoring `spellsClosed` | 0.064 |
| **shipped** | **0.050** |

Calibration tracks the diagonal at the ends — it says 0.99 and is right 97% of
the time, says 0.00 and is right every time — and is **systematically
over-confident in the 0.6–0.9 band** (says 0.85, happens 0.78).

That bias has a cause worth naming, because it is the next piece of §7 rather
than a tuning problem: the hypergeometric assumes the hand is a uniform draw
from the unseen pool, and it is not. Players *cast* the spells they can cast,
so castable spells leave the hand faster than uniform and what remains is
biased towards the uncastable. Fixing it needs the negative inference below —
what they did not cast is evidence — which is unbuilt.

**Their board is a message, not a state.** This is the thing a value function
over afterstates structurally cannot represent, and it is where most of the
bot's current losses live. Update on:

- cost committed versus power shown (§6.2)
- an early or late kész, read against that same statistic
- what they did **not** cast — an obvious target left alone is evidence they do
  not hold the answer
- 8.5.3: a spell with no legal caster and no legal target cannot be played at
  all, so silence is weaker evidence than it looks when their casters are dead

**Bait needs no separate machinery.** A junk unit or a throwaway spell played to
draw out an answer is worth `P(they answer) × the drop in their Θ`. If the card
was going to the 12.5 discard anyway its cost is zero, and that is a genuinely
free trade. Because score already carries unspent payload on both sides, bait
prices itself.

---

## 8. L0 — the match layer, solved exactly

Small enough to be a tabular DP. All six battlefields are face up from
preparation (3.3); only the order is hidden (3.4).

**State:** `(wins_me, wins_them, voided, remaining fields, deck depth both sides)`.

**Rules it must encode, and each one matters:**

- 1.3.2 — an equal sum voids the field for *both*. Not a loss, not a win, and it
  changes what "catch up" means.
- 1.3.7 — the match ends the moment the score cannot be overturned.
- 1.3.4 — 3–3 sends it to A Zóna.
- **2.3.2 / 6.4.6 — A Zóna has no cost cap at all.** So the decider
  is won largely by whoever has material left. Conserved resources carry a large
  terminal value *conditional on reaching 3–3*, which is precisely the kind of
  conditional the DP prices correctly and a hand-tuned heuristic does not.
- 1.3.6 — in knockout play, cumulative power summed across battles is the
  tiebreak. Overkill is not strictly worthless there. Probably ignorable, but it
  is a real rule.

**Interface to L1 is a cost curve, not a stance.** L1 hands up `p_i(c)`: win
probability as a function of committed resources. L0 then allocates across the
remaining fields. Conceding is just `c ≈ 0` on that curve, so there is no
special case for it anywhere.

---

### What it is actually for

Not risk posture in the abstract — a price. §5.3 says the battlefield payoff is a
threshold, so a plan should maximise `P(margin > 0)` rather than the margin, and
the first implementation of both layers maximised the margin anyway. The result
was a bot winning by an average of **+6.65** and losing by **−4.65**, with
"won by eight or more" the single largest bar in the distribution. Every point
of that is worth nothing (1.3.1) and was paid for with cards that would have
flipped the sixteen battlefields it lost by one.

Fixing it took two pieces, and **either one alone changes nothing**:

- a **securing line** past which extra margin stops counting, and
- a **price on spending**, so that buying margin beyond it costs something.

The line alone is a monotonically increasing transform of the margin. It
rescales every option by the same rule and leaves the argmax exactly where it
was — which is not a subtle failure: shipping it produced a re-measurement
byte-for-byte identical to the one before. That is what a no-op looks like when
you were expecting a fix.

The price alone is worse than nothing, because a *flat* price is wrong at both
ends at once. Swept against the baseline over 24 games each:

| price of a card | games won | blowouts ≥6 | narrow losses |
|---|---|---|---|
| none | 46% | 26 | 24 |
| 0.5 | 54% | 14 | 19 |
| 1.0 | 33% | 12 | 25 |
| 2.0 | 21% | 8 | 33 |
| 3.0 | 13% | 5 | 39 |

Blowouts fall monotonically, so the mechanism works — and the win rate falls
with them, because a constant cannot know that a fourth battlefield is worth
everything and a fifth is worth nothing. `fieldValue` is the number that does
know, and `cardPrice` scales the base rate by it: cards nearly free where the
match hangs on this field, prohibitive where it cannot change the result.

That is fold-awareness derived rather than tuned, and it is the thing
`sim/baseline.ts` has had all along via `foldMargin`.

### And it did not work

Measured against the baseline, 40 games per arm:

| | games won | won by | blowouts ≥6 | narrow losses |
|---|---|---|---|---|
| no pricing | 57% | +6.51 | 55 | 46 |
| flat price | 50% | +4.12 | **27** | 47 |
| priced by match | 50% | +4.20 | 28 | 47 |

The overkill goes away exactly as designed — blowouts halve, the average win
drops from +6.5 to +4.2. **And nothing else improves.** Narrow losses sit at
46, 47, 47; the win rate does not rise; and pricing by the match layer is
indistinguishable from a constant.

So the argument this was all built on — that margin wasted on won battlefields
would flip the ones lost by a point — is **not supported by the evidence**. The
resources are successfully saved and then never spent. Nothing tells the planner
that *this* field is the one to commit to, so it economises everywhere and the
game ends with cards in hand.

Why §8 failed to beat a constant is the more useful half. `fieldValue` assumes
`p = 0.5` for every remaining battlefield, so it varies with the **scoreboard**
and not with the board in front of it. It cannot tell a winnable field from a
hopeless one, which is the only discrimination that would make a card cheap here
and dear there. That is the `p_i(c)` cost curve this document specified as the
L0↔L1 interface (§2, §8) and which is still unbuilt — and until it exists, the
match layer has nothing to be right about.

The 40-game samples put Wilson intervals around ±15 points, so "57 versus 50" is
not established either. What *is* established is the blowout halving, which is a
per-battlefield statistic over 200+ fields rather than a per-game one over 40.

---

## 9. Leszerelés and the attrition curve

12.5 lets both players discard any number of cards from either hand, secretly
and simultaneously, before drawing back to seven (12.6). So hoarding never
blocks draws, and a dead card is never stuck.

But digging is not free, and the arithmetic is tight. Thirty cards, seven in the
opening hand, and each cleanup draws exactly `played + discarded`:

> `Σ (played + discarded) ≤ 23` across six battles — under four per battle.

At a mid cost cap you will field around four units a battle unaided, which
consumes the deck with zero digging. 12.7 is the teeth: an empty deck means no
draw and no penalty, you simply fight short-handed — and if the match reaches
3–3, short-handed on the one battlefield with no cost cap.

So `λ(card) = option value + deck-depth cost of replacing it`, with a spike
proportional to `P(reach 3–3)`. Two consequences worth stating as rules:

- **Spend a scarce card only when it flips the result, not when it improves the
  margin.** Margin above the win is worth zero (1.3.1). A one-of bomb is cast
  when it changes `P(win this field)` materially, and held otherwise — its
  option value across later fields does not decay, since 12.5 means it can
  always be pitched if it goes dead.
- **A card in hand exerts pressure only through their belief.** That deterrent
  is the same object as `Θ(theirs)` viewed from the other seat, so it is already
  in the currency.

---

## 10. What stays learned

Two places, both where search genuinely cannot go.

1. **The leaf evaluator** inside the gathering search, for positions where
   running the full plan enumeration is too expensive. This is where the MLP
   from `bot.md` belongs, and per-slot inputs with keyword one-hots are exactly
   what fixes the recorded blindness to `banCasting`, placement rules and
   conditional bonuses.
2. **Mixed strategies for kész and for hiding.** Pure stopping strategies are
   exploitable; the equilibrium mixes. The tractable route is regret matching on
   an abstraction of a single battlefield — state roughly
   `(budget left, my visible total, their visible total, cards left, Θ held)`,
   actions `place / hide / kész`. Small enough to solve honestly, and it is the
   only part of the system that can produce a genuine bluff. Mesteri (§5.6) is
   the natural second candidate, for the same reason.

Everything else — stopping, hiding, bait, concede-or-contest, allocation — is a
comparison of two score numbers under different assumptions.

---

## 11. Build order, with an oracle per step

Each layer is independently verifiable. That is the main practical win over the
current monolith, where a wrong answer has no localisable cause.

| # | Build | Oracle |
|---|---|---|
| 1 | ~~Combo graph from `schema.ts`~~ **done** — `src/bot/combo.ts` | `combo.test.ts`: `modifyPower`+`thresholdAoe(power)` connected; `modifyPower`+`massDestroy(basePower)` not; `setPower`+`massDestroy(basePower)` is; Infiltráció+Hátbaszúrás connected by `enable` and not by `value`; damage+Kegyelemdöfés connected |
| 2 | ~~`Θ` — plan enumeration and valuation~~ **done** — `src/bot/theta.ts` | `theta.test.ts`: hand-computed values on toy boards, including the two combos above and the caster-pricing identity. Exhaustive search was tried as the oracle at scale and is not affordable — see below |
| 3 | ~~`score` = realised + `Θ`~~ **done** — same file | monotonicity holds: adding a castable bomb never lowers score, an unpayable card never moves it |
| 4 | ~~Board optimiser~~ **done** — `src/bot/board.ts` | `board.test.ts`: beam equals exhaustive placement search on constrained boards, including under a cap; and `finalists: 1` demonstrably picks worse |
| 5 | ~~Belief model~~ **done** — `src/bot/belief.ts` | `npm run belief`: Brier 0.050 against 0.243 for guessing the base rate, deck pinned on 100% of observations. `belief.test.ts` pins the mask invariant — moving what the viewer cannot see must not move the belief |
| 6 | ~~Battle-phase plan/schedule/re-plan~~ **done** — `src/bot/planner.ts` | `npm run planner`, 120 games each, battle phase only: **78.2%** vs greedy [69.9, 84.6], **62.5%** vs the trained bot [53.6, 70.6], **57.5%** vs baseline [48.6, 66.0] — that last interval crosses 50%. Self-damage **0 of 1 766 casts** |
| 7 | ~~Gathering search over best responses~~ **done** — `src/bot/planner.ts` gathers, `src/bot/reference.ts` is the yardstick | `npm run planner`, 100 games each: **62.0%** vs never-stops-early [52.2, 70.9] — lower bound above 50, so the oracle passes. Also 83.0% vs greedy, 73.0% vs the trained bot, **57.0%** vs baseline [47.2, 66.3], which still crosses 50 |
| 8 | ~~Match DP~~ **done** — `src/bot/match.ts` | `match.test.ts`: the exact DP agrees with 200 000-trial Monte Carlo on six scorelines, including ones with voided fields. Plus the boundary cases — a field is worth nothing once the match cannot be lost *or* won |
| 9 | Learned leaf, then CFR on the abstraction | arena, multiple training seeds |

Step 7's reference opponent matters independently of everything else here. Both
of the current bot's training opponents stop early by construction, so nothing
in training punishes a modest board — that is the direct cause of the recorded
4:0 loss with margins of 2, 3, 2 and 3, and it is worth fixing whether or not
the rest of this plan gets built. It exists now, as `src/bot/reference.ts`.

### What steps 6 and 7 actually bought

| opponent | battle phase only | with gathering |
|---|---|---|
| greedy | 78.2% [69.9, 84.6] | **83.0%** [74.5, 89.1] |
| trained bot | 62.5% [53.6, 70.6] | **73.0%** [63.6, 80.7] |
| never-stops-early | — | **62.0%** [52.2, 70.9] |
| **baseline** | 57.5% [48.6, 66.0] | **57.0%** [47.2, 66.3] |

Self-damage across all of it: **0 of 2 204 casts**, and 0 abandoned plans out of
roughly 4 500.

Two things to read off that table honestly.

**Gathering by score is worth about ten points against the trained bot and five
against greedy, and nothing at all against the baseline.** The planner is stuck
at 57% there in both configurations, and the interval crosses 50 in both. So
whatever separates it from the strongest opponent is not in either layer built
so far.

**And it did not arrive the way it was predicted to.** The reasoning was: the
baseline gathers for power, so it fields boards that can barely cast, so a
perfect battle phase arbitrates coin flips with about one spell — measured at
**0.95 casts per battlefield**. Gathering by score prices a caster at what it
enables, so casters should get fielded, casts should rise, and the layers should
compound. They did not: **1.03 casts per battlefield**, which is inside the
noise. The win rate moved without the mechanism moving, so the gain is coming
from somewhere else — better boards, not busier ones — and the compounding
story was wrong.

---

## 12. Open, not settled

- ~~**Cost of `Θ` in the hot loop.**~~ **Measured.** ~100 ms per call at the
  shipped budget, ~34 ms at `FAST_THETA`, against a 3-second move budget. Fine
  for play; still heavy for training, where a self-play game makes hundreds of
  calls. The cached-cheap-Θ fallback was needed sooner than expected: the board
  optimiser (§6.1) calls Θ once per finalist, so a gathering decision costs
  `finalists × Θ` — about 600 ms at the defaults. That multiplication, not Θ
  itself, is now what the 3-second budget is being spent on, and it is why the
  budget stays at the measured knee rather than being raised.
- ~~**Θ is verified against itself, not against exhaustive.**~~ **Closed.**
  `theta.oracle.test.ts` generates small boards — one or two casters, one to
  three bodies opposite, one to three cards in hand — and shrinks them until
  exhaustive search is affordable. Over 600 generated boards the exhaustive run
  completed on **every one** (no board hit the lifted caps), 345 had a non-zero
  answer, and Θ at shipped settings disagreed on **none**.

  The mechanism that makes this a real check rather than a restatement is
  `Plan.complete`: a trial only counts when the exhaustive run reports it saw
  everything, so a truncated search can never quietly become the reference.

  And the test has teeth — weakened deliberately, it fails:

  | Θ run as | disagreed with exhaustive | mean shortfall |
  |---|---|---|
  | shipped defaults | 0 / 600 | — |
  | `maxLines: 1` | 14 / 600 | 2.43 (worst 5) |
  | `nodeBudget: 60` | 3 / 600 | 3.00 (worst 4) |
  | `classes: []` | 0 / 600 | — |

  The last row is the honest limit of this oracle. Turning the combo graph off
  changes nothing *on boards this small*, because with one to three cards in
  hand the beam never has to cut and so the setup-preservation rule never has to
  save anything. The rule is covered instead by the hand-built cases in
  `theta.test.ts` — two Explars, and Senyvesztés into Káoszkolera — and by the
  `worthExploring` unit tests. An oracle that exercised it would need boards big
  enough to be unexhaustible, which is the thing that cannot be had.
- ~~**The beam is not the whole story on wide hands.**~~ **Measured, and the
  answer split in two.**

  The proposed fix was to order picks by what the combo graph says the spell is
  for, instead of truncating `legalActions` in arbitrary order. That fix is not
  worth building: over 8 370 pick levels in real games, pick lists run mean 2.39,
  p50 2, p90 5, p99 7, max 10, and **only 1.8% exceed `maxPicks: 6`**. A third of
  levels offer a single forced option. Ordering would touch under one level in
  fifty.

  But the search *does* cut, and much more than expected. With `Plan.complete`
  reporting it honestly, over 817 battle-phase decisions:

  | | share |
  |---|---|
  | decisions where Θ cut something | 29.5% |
  | **decisions where Θ found a plan and cut something** | **58.3%** |

  So the cutting is not at the picks — it is the node budget and the `maxLines`
  beam, on exactly the decisions that matter.

  Two things stop that being alarming, and one thing stops it being fine.

  `complete: false` says "I did not look at everything", not "I got it wrong",
  and it is deliberately trigger-happy: a spell exhausting its own share of the
  budget sets it, as does the beam dropping the 13th of 14 completed lines.
  Against that, quadrupling the budget from 800 to 4000 changes the answer on
  only 2.8% of decisions. Since a search that cut nothing cannot be improved by
  more budget, those disagreements must all sit inside the truncated 29.5% —
  which puts the disagreement rate *within* truncated decisions at roughly
  **9.5%** (2.8 / 29.5; the two figures come from different samples, so treat
  it as an estimate rather than a measurement).

  What stops it being fine: that 2.8% is agreement between two *truncated*
  searches. Budget 4000 cuts too. The only untruncated evidence is the
  exhaustive oracle above, and that lives on boards far smaller than the ones
  where cutting happens. The gap is real and this is the sharpest statement
  available: **Θ is exactly right where it can be checked, and knowingly
  approximate on most of the decisions where it has something to say.**
- **How many determinizations.** `Θ(theirs)` is an expectation over the belief.
  Eight samples is a guess.
- **Whether L1 needs to exist separately.** It may collapse into L0 plus score
  with nothing left in the middle.
- **The interaction between hiding and the cost cap check.** 7.4 loses the
  battlefield outright for going over, and the budget is privately tracked
  (6.4.2). A bot that miscounts its own hidden costs throws the field for free.
  Non-issue for the engine, but the belief model must not assume the opponent
  is immune to it either.
- ~~Whether bundle enumeration stays small on live card data.~~ **Measured.**
  It does, once value subsets and enable pairs are enumerated separately: 2
  candidates at the median, 41 at p99, 108 at the worst of 12 114 decisions.
  See §5.2.1. `npm run combos` re-runs it, and it should be re-run whenever the
  spell set changes shape.
- **Whether the `slot` read is too broad.** Every targeted spell reads its
  caster's tile for range, so any movement spell links to all of them. Board-
  aware refinement — only counting the edge when the mover could actually reach
  a tile that changes legality — would cut the enable pairs, and the current
  numbers are cheap enough that it has not had to.
- **Whether the graph should carry units as well as spells.** `unitTouches`
  exists and is unused: a Belépő that damages is a setup for Kegyelemdöfés
  exactly as a spell would be, and an aura source is half of most indirect
  edges. Adding them widens the components and has not been measured.
