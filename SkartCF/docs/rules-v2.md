# Skart 2 — Rules Standing (v2)

Two-player tactical card game for a summer camp. Five-minute teach, no referee, no external trackers. You fight for locations one at a time by committing units under a cost cap while feeding a hidden spell stack, then the stack resolves and the boards are compared. No player HP, no lingering damage between locations.

Supersedes the migration doc. Changes from v1 are marked (v2).

---

## Win condition

Seven battlefields: three brought by each player, plus Végtelen puszta. All six player battlefields are revealed publicly before the game starts, so both players know what fights are coming. Only the order is unknown, determined by shuffling them into a face-down sequence. (v2)

Locations are fought one at a time in that order. After six, whoever holds more wins. Végtelen puszta is played only if the score is tied, including ties caused by voided locations.

**Végtelen puszta removes the cost cap and nothing else.** (v2) Hand is still 7, the grid is still six slots, and every other rule stands. It is a fight over power per slot, not a dumping ground for everything you banked.

---

## Core loop per location

1. Reveal the location: cost cap plus effect.
2. **Commitment.** Players alternate playing units and stacking spells until all four stop flags are closed. Belépő abilities fire as units land.
3. **Reveal.** Hidden units are turned face-up and their Belépő abilities fire now.
4. **Spell phase.** The committed spell stack resolves in play order.
5. **Totaling.** Sum both boards against the final state and compare. Higher total takes the location. **Equal totals: nobody takes it.** (v2)
6. Spent cards are gone. Draw both hands back up to 7.

---

## The commitment phase (v2)

There is no passing. There is only **stopping**, and stopping is permanent for the rest of the location.

Each player carries two independent flags, one for units and one for spells. Turns alternate. On your turn you may do any or all of the following:

- play one unit to a slot, if your unit flag is still open
- slide one spell face-down onto the shared stack, if your spell flag is still open
- declare **units done**, closing your unit flag
- declare **spells done**, closing your spell flag

You may drop the two flags at the same time or many turns apart. Once a flag is closed you may never play that card type again this location, even if the opponent keeps going. A player with both flags closed is skipped, and the opponent keeps taking turns alone. The location ends when all four flags are closed.

Committed unit costs must stay within the location's cost cap. The cap counts unit costs only. Spells are paid for out of spellpower at resolution, not out of the cap. (v2)

Cards spent are spent, win or lose.

### Why stopping is expensive

Because you can never re-enter, declaring units done tells the opponent exactly what they have to beat, and lets them beat it by the smallest margin they can afford. Stop too early on a board you did not want and they take it with one rat. Stop too late and you have overspent into a total they simply refuse to match.

This makes conceding a location cost something, which passing never did. It also makes overcommitting punishable: they can just stop below you and keep their cards.

What stops this from being a solved arithmetic problem is that the visible total is not the real total. Hidden units and the unresolved stack both sit outside it. Stopping units at 14 against a visible 15 is fine if you have three spells still to come, and the opponent cannot know that.

### Reading the two flags

Declaring spells done is the louder announcement of the two, because it is the moment your board total stops being able to change. As long as either player has spells open, every number on the table is provisional.

The order you drop the flags is therefore a tell. Closing units early while staying open on spells reads as a small board with a big stack, threatening to flip a losing total. That is the archmage line, and it works: a player with units closed still gets a turn every round to stack, so spell volume never depends on fielding bodies.

### Automatic stops

Two flags close on their own, both for reasons the opponent can already see:

- your unit flag closes when your hand is empty or all six of your slots are full
- your spell flag closes when your spell hand is empty

Nothing else auto-closes. If you hold cards you cannot legally play, that is your information to protect and your decision when to give it up. Declaring done in that spot is usually right, since sitting open with nothing to play wastes turns while the opponent keeps building, but staying open as a bluff is legal and sometimes correct.

### Turn order

The player who brought the current battlefield goes first. (v2) This is a mild cost on units, since you spend cap and reveal intent one step ahead, and a mild gain on spells, since you get the bottom of the stack and therefore the first resolution. The two roughly cancel.

---

## The grid

Each player has a 2x3 grid: front row F1 to F3 facing the enemy, back row B1 to B3 behind. Column 1 faces column 1, column 2 faces column 2, column 3 faces column 3.

**Units are placed face-up.** (v2) The old front-revealed / back-hidden split is gone. Hiding is now an optional, paid action (below).

Melee units get +1 in the front row. Mages, support and animals carry no positional keyword and get nothing either way.

### Range geometry

Front rows touch across the centerline. Shared edge is range 1, shared corner is range 2, each further edge crossing adds 1. There is no centerline gap. (v2, confirmed)

Distance from each enemy front slot to each of my slots:

| My slot | from their F1 | from their F2 | from their F3 |
|---|---|---|---|
| F1 | 1 | 2 | 3 |
| F2 | 2 | 1 | 2 |
| F3 | 3 | 2 | 1 |
| B1 | 2 | 3 | 4 |
| B2 | 3 | 2 | 3 |
| B3 | 4 | 3 | 2 |

Every slot on the board is reachable at range 2 by exactly one enemy front slot. Nothing is ever out of reach. What the back corners buy is the tail: worst case 4 instead of 3, and only one enemy position that gets a cheap shot.

Protection therefore comes from open placement rather than geometry. You can see where their casters are standing, so putting a bomb in the corner diagonal from their only mage is a read, and if they committed the caster first they cannot take it back.

Front center is the most exposed slot on the board (1/2/2). Front corners trade one reach for one safety step. Back corners are the shelter, at the price of short reach and limited adjacency bonuses.

---

## Hiding a unit (v2)

A unit may be committed face-down instead of face-up, at a cost paid in card attrition.

A face-down unit's identity, power and cost are all concealed. Its Belépő fires at reveal rather than on placement, which is the main reason to pay for hiding something like Bérgyilkos.

Hiding does not protect against removal, since spell targets are chosen after reveal. What it buys is the earlier decision: the opponent cannot know whether stacking removal is worth it.

### The price: discard one unit card from hand

You choose the card, and it can be any cost. Since there is no toss at the end of a location, this costs you a playable option on the board in front of you, and it pulls one more card off a finite deck. Both halves are real.

It leaks nothing, needs no verification beyond watching a card go to the discard pile, and the player picks what to lose rather than having it taken.

---

## Unit abilities

**Belépő** fires the moment the unit is placed, during the commitment phase. (v2, replaces Mustra) It is mandatory. Bérgyilkos placed into a column kills the weaker unit already sitting across from it, right now, in front of both players. On a hidden unit the Belépő fires at reveal instead.

Because Belépő resolves live, holding a column empty against a known Bérgyilkos is a real defensive line, and it costs the defender a slot. The counter is to keep committing elsewhere and force them to spend it into nothing before they run out of cap.

**Static abilities** are continuous and read at totaling. Pack bonuses, isolation bonuses, adjacency effects, Vérfarkas checking who is directly opposite. A kill mid-phase changes what the survivors read, so killing a unit can buff what is left, including your own.

Locked terminology: **szomszédos** is a shared edge (orthogonal). **Átlósan érintkező** is corner contact only. Separate relationships. Októ's diagonal contact includes your own units.

---

## Spells

### The stack

One shared stack. Both players commit into it during the commitment phase, interleaved in true play order. At combat the whole pile flips and resolves in play order, first played first. Cost has no bearing on resolution order.

Targets and casters are chosen at resolution, not at commit. A spell with no legal caster or no legal target is skipped and the next one resolves.

The stack's height and ownership order are public. Its contents are not. With units open, this is where the entire information game now lives.

### Casting

Any unit with enough spellpower of the right school can cast. The caster is not precommitted. Spell cost equals the spellpower required. (v2)

No pooling: two units with 3 spellpower cannot fund a 6-cost spell. Points deplete across the stack in resolution order, so a mage who funds a 6-cost spell early has nothing left for the 1-cost spell you stacked behind it.

Range is measured from whichever caster you nominate.

### Spell hand

Spell hand of 7, draw to 7. Spell deck 30. (v2)

The multi-school tax no longer comes from dead draws. It comes from the board: spellpower is per-unit and school-locked, so running two schools means fielding casters of both, competing for six slots and one cost cap.

### Design rules for spell content

Damage is a persistent −X token placed on the unit and summed at totaling. Never instant loss, never a wound carried between locations. Damage to 0 kills, and the unit is removed from its slot immediately.

AoE is always a threshold effect, never distributed damage. "All enemy units at or below power X get −Y" reads the board as one set of removals and debuffs. It auto-scales, wrecks swarm, whiffs on value boards, and requires no tracking. Never "deal X to multiple units."

Attachments use "amíg X rajta van". The physical card on the unit is the effect, so removing the card removes the effect. No duration tracking.

Set-stat overwrites (Jéghegy sets power 1, Enormorf sets power 6) instead of modifying, to sidestep stacking math.

Prefer power-debuffs over threshold damage for single-target. A −2 always shifts the comparison; damage is dead unless it crosses 0.

Forbidden: healing, per-round escalating damage, spell-modifies-spell effects.

### Reading stats

Whatever stat the card names is the stat checked. A card that says base power reads base power. A card that says power reads the current value including bonuses and tokens. (v2)

### Effect ordering

Later effects resolve later, but the wording decides the outcome. A set-power effect followed by a −2 attachment leaves the attachment applying to the new value, which can kill. Jéghegy specifically does not, because it makes the target untargetable. A set-power spell without that protection would. (v2)

### Physical tracking

Spell cards are smaller than unit cards. A unit holds a fan of unresolved spells and a fan of resolved ones. The pile is the record.

---

## Card economy

Hand size 7, draw to 7. **There is no toss, automatic or optional.** (v2) You keep whatever you did not spend, and refill only what left your hand. This severs card advantage from board tempo: winning cheap refills fewer cards, so a cheap win never compounds.

Each card type has its own outlet for cards you cannot use, and neither one is free. A dead unit pays for hiding another unit. A dead spell goes onto the stack as a bluff (below). Both cost one card and both buy the same thing, which is a decision the opponent has to make under uncertainty.

### Bluffing the stack

Not a rule, just how the rules already work, and it should be taught as the intended play. A spell with no legal caster fizzles at resolution and does nothing. So a spell you cannot cast is still worth stacking: the opponent watches an entry go face-down and has to price it as possibly Argeo. They may hold a unit back, spend a protection spell, or stop units earlier than they wanted.

This is how a splash-school hand or a spell you have no caster for gets cleared, and it is the symmetric partner to paying a unit card to hide a unit.

**Unit deck: 30 or 40, testing both.** (v2) Thirty makes every fight a supply decision and forces conceding a location to be a real choice. Forty lets kids actually play cards instead of hoarding them across an attrition war. Camp playtest decides.

Empty deck: draw nothing, no penalty, no reshuffle. Play out what is in hand.

Cost is decoupled from power. Ogre power 6 cost 4, archmage power 3 cost 7, rat power 1 cost 0. No single number ranks all units, which is what stops both swarm-by-bodies and value-by-one-fatty from auto-winning.

### Cost curve

Baseline battle power is roughly cost+1 for vanilla units, higher in higher tiers, heavily synergy-modified.

| Cost | Tier |
|---|---|
| 0 | rat, beggar, chicken (fodder) |
| 1 | peasant, thief |
| 2 | militia, wolf, scout |
| 3 | archer, light spearman |
| 4 | professional soldier (Felindori kardforgató), the baseline |
| 5 | veteran, knight, bear |
| 6 | ogre, troll, champion |
| 7-8 | warlord, werewolf, griffin |
| 9-10 | giant, wyvern |
| 11-12 | Gouraldir tier |
| 13-14 | demigods |
| 15 | god |

The scale is compressed at the bottom, so +1 is proportionally huge for cheap units and noise at the top. Positional and cluster bonuses therefore belong to the swarm end by arithmetic, with no rule needed.

Casters are priced separately. An archmage is power 2, spellpower 7.

### Balancing guards

Battlefield effects tilt efficiency and reward, never gate card types. "+1 per point of cost here" is fine. "Cheap units cannot be played here" is banned.

**Target tilt is a swing of 3 to 6 points in the favored deck's direction on a typical board.** (v2) That is enough to matter next to a cap-8 fight and small enough that a better army, better spellcasting, or a well-timed stop beats it.

**Hard failure condition: if any deck wins any single battlefield more than 75% of the time, that battlefield or that deck is broken and gets changed immediately.** (v2) This is the number the simulator exists to measure.

The reason it is a hard line and not a preference: all six battlefields are public from turn one. If your three boards are reliably yours and mine are reliably mine, the correct play for both of us is to concede all six with one rat each, go 3-3, and dump two nearly full decks into Végtelen puszta. The first six locations become a formality. Stealing one enemy board wins 4-2 and ends the game early, so hostile turf has to stay winnable or the whole structure collapses into a single fight.

Watch the fraction of playtest games that reach Végtelen puszta. If it is most of them, tilt is too strong.

The six-slot limit does put a ceiling on how well the concede line pays. A player who banked twenty cards still fields six units on Végtelen puszta, so everything past the best six in hand is dead weight. Conceding buys you selection, not volume. That is a real check, though it does not remove the problem: selection across a 30-card deck is worth a lot when the cap is gone.

Probing is the natural counter and should stay cheap. One unit committed to their board forces them to spend; if they overreact you stop and lose the location for one card while they burned four.

Reach-tools are sharpest on hostile turf. Swarm's count-scaling debuff is best against the few big units a value deck fields; value's efficiency is best on high caps.

The hidden spell stack lets skill override the tilt.

Three rats on a location is supposed to be bad. They are fodder for AoE-buff and count-payoff units, not a winning play on their own. Swarm is a build-around, and whichever class owns cheap bodies owns the AoE payoffs.

---

## Six classes

Harcos, Mágus, Vaják, Zsivány, Bölcs, Garabonciás. Identity across three axes: combat profile, which spell schools they channel and how much, and archetype payoff (who owns swarm fodder and AoE, who owns giant-slayers, who owns disruption). Detailed kits TBD.

---

## Open rulings

- Whether more than one unit may be hidden per location. Self-limiting either way, since each one costs a card, but a hard cap of one is the safer starting point.
- Whether you may hide when your hand holds only the unit you are committing, meaning no card left to pay with. Simplest answer is no.
- Whether a stolen or converted unit keeps its Belépő and spellpower. Rule "power only, not abilities," or cut those spells.
- Whether melee front-row +1 is large enough to be worth taking once −2 melee spells exist. Be ready to make it +2.

## Open questions for playtest

1. Does cheap movement kill positional AoE? A 1-cost slide dodging a 6-cost row-wipe every time it is read means AoE has to lean on power thresholds rather than rows.
2. With a 7-card spell hand and open units, is removal now too consistent? The check is spellpower and the range map. If the best unit on the board always dies, tighten spellpower rather than range.
3. Do spells feel co-equal with the army phase, or a side dish? Armies deciding most fights with spells swinging the close ones is healthy. Spells deciding everything makes unit commitment decorative.

---

## WIP spell list

Format: Név / Iskola / Költség / Hatás / Hatótáv / Ritkaság.

| Név | Iskola | Költség | Hatás | Hatótáv | Ritkaság |
|---|---|---|---|---|---|
| Explar | Mágus | 1 | −1 to a unit | 2 | Gyakori |
| Harapás | Állat, Bestia | 1 | −2 to a unit | 1 | Gyakori |
| Álomfogó | Mágus | 2 | ally: next spell of cost 5 or less on it fizzles | 1 | Gyakori |
| Manőver | Harcos | 1 | self-move to adjacent tile | 0 | Gyakori |
| Tűzköpeny | Mágus | 1 | ally: immune to Tűz spells | 1 | Gyakori |
| Fagypáncél | Mágus | 1 | ally: immune to Fagy spells | 1 | Gyakori |
| Teleport | Mágus | 4 | move an ally to any empty tile | 1 | Kivételes |
| Jéghegy | Mágus | 6 | lock a unit: untargetable, cannot cast, power 1 | 2 | Legendás |
| Argeo | Feketemágus | 8 | destroy a unit | 2 | Legendás |
| Lépumorf | Mágus | 7 | turn a unit into a Nyúl (abilityless Állat, power 1) | 2 | Kivételes |
| Enormorf | Mágus | 6 | a unit's power becomes 6 | 1 | Ritka |
| Idézés | Mágus | 5 | summon a unit from hand to adjacent tile (counts vs cap) | 0 | Kivételes |
| Széllökés | Mágus | 1 | move a unit to an adjacent tile | 1 | Gyakori |
| Acélpenge | Harcos | 1 | ally: +1 power (attachment) | 1 | Gyakori |
| Vaskarom | Mágus | 1 | ally: +1 power ring (attachment) | 1 | Gyakori |

Next content step: a first spell set of six to eight across two schools, built to stress the questions above. Some power-threshold AoE against some positional AoE, some cheap movement, a couple of range-3 reach spells to test whether the back corners are worth taking.

---

# Technical notes for building this

Target: a browser prototype for solo testing and balance simulation first, hotseat playable second, networked multiplayer only once the rules stop moving.

## Stack

TypeScript, React, Vite, no game engine. The board is twelve divs. Deploys static.

## Architecture, the one thing that matters

Keep the rules engine as pure functions in `src/engine/`, with zero React imports. React only renders state and dispatches actions.

```
engine/
  types.ts        state, card, effect type definitions
  grid.ts         slot adjacency, range lookup
  reducer.ts      applyAction(state, action) => state
  resolve.ts      spell stack resolution
  effects.ts      one handler per effect type
  totaling.ts     final board sum
data/
  units.json
  spells.json
  locations.json
ui/
sim/
  run.ts          headless N-game runner
```

The reason for the split is not tidiness. It is that a headless script must be able to play ten thousand games and report win rate by location cap, by deck archetype, by who commits first. That is the actual payoff of building this rather than printing more paper, and it is impossible if the rules live inside components.

## Cards are data, never code

Every card is a JSON row with an effect type and parameters. No card-specific branches in the engine.

```ts
type Effect =
  | { kind: "modifyPower"; amount: number; target: TargetSpec }
  | { kind: "setPower"; value: number; target: TargetSpec }
  | { kind: "destroy"; target: TargetSpec }
  | { kind: "move"; target: TargetSpec; destination: "adjacent" | "anyEmpty" }
  | { kind: "transform"; into: string; target: TargetSpec }
  | { kind: "attach"; attachment: string; target: TargetSpec }
  | { kind: "thresholdAoe"; stat: "power" | "basePower"; atMost: number; amount: number; side: "enemy" | "ally" | "all" }
  | { kind: "grantImmunity"; school: string; target: TargetSpec };

type TargetSpec = {
  side: "enemy" | "ally" | "self" | "any";
  range: number;          // measured from the nominated caster
  filter?: { keyword?: string; maxCost?: number; origin?: string };
};
```

Rebalancing is then editing a number in JSON, not editing code. Same for units: power, cost, spellpower per school, keywords, Belépő as an effect object.

## Stat reads

The engine needs two distinct accessors and they must never be confused:

- `basePower(unit)` returns the printed value
- `power(unit, board)` returns printed value plus positional bonuses plus location effect plus tokens, clamped at 0

Every effect declares which one it reads, taken straight from the card text. Threshold AoE and kill checks are the places this bites.

## Range

Build a twelve-node graph once: six own slots, six enemy slots, front rows edge-connected across the centerline. Edge is weight 1, corner is weight 2, then breadth-first search. Precompute the full 12x12 distance matrix at startup and index into it forever. Write the range table from the rules doc as a unit test.

## The spell stack is the hard part

Resolution cannot be a single function call, because targets and casters are chosen mid-resolution and the choosing player alternates unpredictably. Model it explicitly:

```ts
type ResolutionState = {
  queue: StackEntry[];
  index: number;
  awaiting: null | { player: PlayerId; entry: StackEntry; legalCasters: SlotId[]; legalTargets: SlotId[] };
  board: Board;
};
```

The engine advances until it needs input, sets `awaiting`, and stops. The caller supplies a choice, the engine applies it and advances again. Fizzle is just `legalCasters.length === 0 || legalTargets.length === 0`, which advances the index without asking anyone. The simulation runner supplies choices from a policy function instead of a human.

Get this shape right at the start. Retrofitting it onto async calls is miserable.

## Stop flags in state

Four booleans, not a turn counter:

```ts
type Flags = { unitsClosed: boolean; spellsClosed: boolean };
type Board = { p1: Flags; p2: Flags; /* ... */ };
```

`legalActions(state, player)` returns an empty array when both of that player's flags are closed, and the turn loop skips them rather than ending the phase. The phase ends only when all four are true. Auto-closing (empty hand, six slots filled, empty spell hand) is checked after every action and applied by the engine, not the UI, so the simulator and the hotseat agree.

This is also the cleanest place to hang the AI policy hooks, since "when do I stop" is the single most important decision in the game and the one you most want to sweep across parameter values.

## Order of operations, encoded

1. Commitment actions apply Belépő immediately on placement
2. Reveal flips hidden units, fires their Belépő in placement order
3. Stack resolves in play order, each entry fully applying before the next
4. Totaling reads the final board

Static abilities are never applied as state mutations. They are computed on read, inside `power()`. This is what makes "killing a unit buffs the survivors" fall out for free instead of needing recalculation hooks.

## Build order

1. Types, grid, range matrix, totaling. Test with hardcoded boards.
2. Commitment loop with the four stop flags, hotseat, no spells. This is already playable and already tests both the Belépő timing question and whether stopping feels tense.
3. Spell stack with resolution queue.
4. Effect handlers, one at a time, each with a test.
5. Headless simulator with a dumb greedy policy. The first number to read is win rate per deck per battlefield, against the 75% line.
6. Card editor UI, or just hand-edit JSON.

## Card art and performance

Not a concern. Sixty to ninety images at 400px wide in WebP is somewhere around 2 to 5 MB total, which is one mid-size photo. Browsers composite hundreds of images without noticing; the twelve on screen at once is nothing.

The only thing that would cause trouble is dropping in 3000px PNGs straight from an art export, which would be tens of megabytes on first load. Resize once at build time and stop thinking about it.

For the prototype, skip art entirely. Colored rectangles with name, cost, power and spellpower are more readable during balance testing anyway, and they cost nothing to change when a card gets renamed.
