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

### Why `Θ` and not a weighted spellpower feature

Spellpower and power have no common scale. Multiply every spell cost and every
unit's spellpower by ten and the game is unchanged, but any hand-weighted
"power + k · spellpower" heuristic changes completely. `Θ` is immune, because it
is mediated by what the spellpower can actually pay for.

The same argument gives the value of removing a caster, without a weight:

> `value(killing caster c) = Θ(their board, their hand) − Θ(their board − c, their hand)`

in power units. Disabling works identically, since 10.7.1 shuts off spellpower
too.

### Score is asymmetric in information

`Θ(mine)` is exact — own hand is known. `Θ(theirs)` is an expectation over the
belief (§7). Do not pretend otherwise anywhere in the stack.

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
3. Enumerate bundles over those chains. Castability collapses the set hard: a
   real board has two to five spells that are actually payable, in range, and in
   line of sight, so this is tens of bundles, not thousands of move sequences.

Non-threshold targets still matter for raw margin. For those, take the maximum
and stop; there is nothing combinatorial there.

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
- **Movement costs a whole turn** and moves the margin by zero, so it must buy
  more than a turn. In practice: never open with it.

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

4.8.7 (hidden units block line of sight) is vestigial in practice: everything is
revealed at Mustra (7.2) and nothing casts before then (5.3).

---

## 7. Belief

Against a known deck this is cheap and strong, and the current bot has none of
it.

**Base.** Their hand is a draw from `deck − graveyard − revealed`. The graveyard
is public and inspectable at any time (1.5.4, 2.4.4), the deck counts are public
(1.5.1). Hypergeometric, exactly.

**Resolution: school payload, not cards.** The quantity that matters is
`P(they can cast school S at level ≥ n, in range, with line of sight)`. Model
that, not individual card identities. Decks are built so casters and spells
match, so a Druida on their board raises the probability that they hold Druida
spells well above the marginal rate — from deck composition *and* from the play.

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
- 1.3.4 — 3–3 sends it to the Végtelen puszta.
- **2.3.2 / 6.4.6 — the Végtelen puszta has no cost cap at all.** So the decider
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
| 1 | Combo graph from `schema.ts` | assert known pairs: `modifyPower`+`thresholdAoe(power)` connected; `modifyPower`+`massDestroy(basePower)` not; Infiltráció+Hátbaszúrás connected |
| 2 | `Θ` — plan enumeration and valuation | exhaustive plan search on toy boards; hand-checked combos from `abilities.md` |
| 3 | `score` = realised + `Θ` | monotonicity: adding a castable bomb to hand must not lower score |
| 4 | Board optimiser | brute force over small hands and caps |
| 5 | Belief model | calibration on self-play logs: predicted school payload vs actual |
| 6 | Battle-phase plan/schedule/re-plan | beats the current bot head to head; self-damage rate near zero |
| 7 | Gathering search over best responses | beats a **never-stops-early** reference opponent |
| 8 | Match DP | Monte Carlo over the same `p_i` |
| 9 | Learned leaf, then CFR on the abstraction | arena, multiple training seeds |

Step 7's reference opponent matters independently of everything else here. Both
of the current bot's training opponents stop early by construction, so nothing
in training punishes a modest board — that is the direct cause of the recorded
4:0 loss with margins of 2, 3, 2 and 3, and it is worth fixing whether or not
the rest of this plan gets built.

---

## 12. Open, not settled

- **Cost of `Θ` in the hot loop.** Every layer calls score, and score runs plan
  enumeration. If it does not come in fast enough, the fallback is a cached
  cheap `Θ` for interior nodes and the full one at leaves — but the cutover
  point is unmeasured.
- **How many determinizations.** `Θ(theirs)` is an expectation over the belief.
  Eight samples is a guess.
- **Whether L1 needs to exist separately.** It may collapse into L0 plus score
  with nothing left in the middle.
- **The interaction between hiding and the cost cap check.** 7.4 loses the
  battlefield outright for going over, and the budget is privately tracked
  (6.4.2). A bot that miscounts its own hidden costs throws the field for free.
  Non-issue for the engine, but the belief model must not assume the opponent
  is immune to it either.
- **Whether bundle enumeration stays small on live card data.** The claim in
  §5.2 is that castability collapses it to tens. Unverified against
  `units.json` / `spells.json`; that is the first measurement to take.
