# Ability inventory — what the cards do

This document is the complete ability analysis of the Skart card set. Every
unit, spell and battlefield text is traced back to a **parameterised
primitive**. The engine never branches on a card id: a card is a row of data
naming a `kind` and its parameters. Building a new, similar card in the editor
is therefore always parameter-setting, never coding.

There are three tables, all declared in `schema.ts`, and all three are rendered
by the same generated editor form:

| Table | When it runs | Where |
|---|---|---|
| `STATIC_SPECS` | continuously, computed on read | `power.ts` |
| `EFFECT_SPECS` | once, when it fires | `effects.ts` |
| `LOCATION_EFFECT_SPECS` | for the whole battlefield | `power.ts` / `reducer.ts` |

## Design principles: build from blocks, animate for free

Two rules govern every new ability, and they are the reason this document
exists:

1. **Compose, never duplicate.** A new ability is a new *combination* of
   existing primitives — an effect kind plus a target filter plus a condition
   from the shared enum — before it is ever a new kind. Five different "kill a
   unit" spells are one `destroy` with five filters (§2). Every "+X if …" unit
   is one `powerBonus` with a condition value (§1). If a card text seems to
   need new code, first try to express it as parameters on what exists; only
   when that genuinely fails does `schema.ts` grow a new kind — and that new
   kind should itself be parameterised broadly enough that the *next* similar
   card is data again.

2. **Reused primitives reuse animations.** The game screen's theatre
   (`src/ui/game/theatre.ts`) never animates effects by name — it diffs the
   state before and after an action and emits beats: `land`, `veil`, `reveal`,
   `cast`, `fall`, `march`, `strike`, `draw`, `toss`, `battlefield`, `step`.
   Any ability composed from existing primitives is therefore fully animated
   the moment it exists, because its consequences (a unit dying, moving,
   getting struck, cards drawn) are already beats. A bespoke ability that
   invents a new *category* of state change is also signing up to invent a new
   beat and its presentation. Staying inside the building blocks keeps the
   whole animation layer at zero marginal cost per card.

---

## 1. Static abilities (`statics`)

Fourteen primitives cover every continuous ability across all 88 units.
Attachment cards (spells that sit on a unit) can carry **the same ones**, which
is why Falanx, Vérszomj, Halálfélelem and Csordaszellem need no code of their
own.

| Primitive | Parameters | What it covers |
|---|---|---|
| `powerBonus` | `amount`, `condition`, `value` | Vízköpő, Hetvenkedő katona, Sir Werdzsell, Medve, Ninja, Guner, Vérfarkas, Cassanus, Felindori íjász (Távolsági), Falanx, Kopja, Halálfélelem |
| `countBonus` | `amount`, `side`, `scope`, `keyword`, `requires`, `atLeast` | Farkas, Papagáj, Zsalu, Bárkakedvenc, Piráto Sanchez, Korgon, I. Iniquus, Vérszomj |
| `aura` | `amount`, `side`, `scope`, `keyword`, `maxBasePower`, `atLeastCount` | Kovács, Altus, Lényidomár, Maffiavezér, Simorf, Welsing, I. Iniquus, Csordaszellem, Egységben az erő |
| `auraGrant` | `side`, `scope`, `grant`, `keyword`, `cardId` | Kém, Bol'Jin, Fehér Pásztor, Welsing |
| `selfGrant` | `grant`, `condition`, `value` | Fehér Pásztor, A Moirák, Cassanus, Umbradog, Sárkánypikkelyek, Füstbomba, Odú |
| `powerFloor` | `side`, `scope` | Faun |
| `redirectSpells` | `side`, `scope` | Dionzosz |
| `suppressOpposed` | `condition` | Vérfarkas |
| `spellMod` | `what`, `amount`, `tag`, `school` | Explodus, Erif mester |
| `freeCasts` | `count` | A Moirák |
| `banCasting` | — | Omen |
| `placementRule` | `requireAdjacentKeyword` | Papagáj |
| `selfRestrict` | `restrict` | Némítás, Indák, Kötél, Szorítás, Elfeledés |
| `powerOverride` | `mode`, `value` | Természetes forma, Enormorf |
| `damageCap` | `amount`, `side`, `scope` | A Faarcú — one effect can deal at most this much damage |
| `castRing` | `amount`, `side`, `keyword` | Elfina — the targeted allied Állat gains a ring |

### The `condition` enum

A single condition enum serves both `powerBonus` and `selfGrant`:
`always`, `frontRow`, `backRow`, `enemyHalf`, `noHidden`, `opposedOccupied`,
`opposedEmpty`, `opposedWeaker`, `opposedStronger`, `isolated`,
`isolatedDiagonal`, `aloneInRow`, `aloneInFrontRow`, `aloneOnBoard`, `immobile`,
`graveyardAtLeast`, `noPlacedOnMe`.

Building a new "+X if …" unit is therefore always: `powerBonus` + the right
condition. If the condition you need is missing, extend the enum — one new
value serves every future card that wants it, and the editor picks it up from
the schema automatically.

---

## 2. Effects (`effects`)

Fire once: from a Belépő, from a trigger (`triggers`), or from a spell cast
during the battle phase.

### Board effects
`modifyPower`, `setPower`, `damage`, `destroy`, `massDestroy`, `move`,
`swapWithAdjacent`, `transform`, `attach`, `grantImmunity`, `fizzleShield`,
`lock`, `summon`, `thresholdAoe`, `grantRing`, `duel`, `devour`, `advance`,
`modifySpellpower`, `revealHidden`, `clearPlaced`.

The amount of `damage` can come three ways: `amount` is the fixed number;
`altAmount` + `altIf` is the second number when the condition holds for the
targeted unit (Hátbaszúrás: 2, or 4 in the back row); `casterPowerDiv` derives
it from the caster's power (Eltaposás: half, rounded up). A `fizzleShield` with
`maxCost: 0` means **no** cost limit — Álomfogó and Omnifex swallow the next
spell that lands on them regardless of what it cost.

### Card-economy effects
`draw`, `discard`, `searchDeck`, `revive`, `returnToHand`, `stealCard`,
`bounceToDeckBottom`, `swapHandGraveyard`, `drawNextLocation`, `coinFlip`,
`peek`, `handSwap`, `setTrap`, `portal`, `note`.

### Effects that ask

Most effects never need to ask: when the card text says "one" and the choice
is not interesting, the data says which — that is what `pick` is for. Where
the choice itself *is* the ability, it asks:

| Primitive | What it asks | Card |
|---|---|---|
| `searchDeck` | which card comes out of the listed deck or graveyard | Sírásó, Feltámadás, Lingadori könyvtár |
| `handSwap` | which cards you take, then which you give back | Griff, a hamiskártyás |
| `setTrap` | which spell goes down, and onto which enemy tile | Fuedrax |

These put a `Prompt` on the queue (`prompts.ts`) and stop; until it is
answered, nothing else can happen in the game. The answer arrives as an
ordinary action (`answerPrompt`, `finishPrompt`), so the bot and the simulator
can play these cards without knowing they exist. The completion handler is
keyed by `kind` in `interactions.ts`, never a closure — a prompt has to
survive the `structuredClone` the bot uses to evaluate positions.

These three are the first asking effects, not the only ones the machinery is
for. A new asking ability is one prompt `kind` and one completion handler —
the same two edits as a new effect — and nothing else in the engine needs to
know it exists.

`peek` does not ask, but writes a `Reveal`: what was seen, and who is entitled
to see it. `portal` does not ask either; it only records where the unit stood
when the battle was decided.

### The target filter is what folds the kill spells into one primitive

Óriásölő, Fojtás, Rajtaütés, Kegyelemdöfés and Carnifex are all `destroy` —
only their filters differ:

| Card | Filter |
|---|---|
| Óriásölő | `minPower: 8` |
| Fojtás | `maxPower: 3` |
| Rajtaütés | `isolated: true` |
| Kegyelemdöfés | `damaged: true` |
| Carnifex (Belépő) | `maxBasePower: 4` |
| Valóságtörés | `hasPlaced: true` (mass) |

The `TargetFilter` fields: `keyword`, `keywords` (any of), `notKeyword`,
`maxCost`, `minCost`, `maxBasePower`, `minBasePower`, `maxPower`, `minPower`,
`damaged`, `isolated`, `hasPlaced`, `hidden`, `row`, `weakerThanCaster`.

Every effect receives the same three gates: `if` (+ `ifValue`) from the
condition enum above, plus `ifKeyword` and `ifNotKeyword` on keywords. Sújtás
is assembled from these: 3 damage `ifKeyword: "Élettelen"`, 1 damage
`ifNotKeyword: "Druida,Állat,Élettelen"`, and nothing for the children of
nature.

---

## 3. Triggers (`triggers`)

Beyond the Belépő there are five events. This is what makes the **ring**
possible: power granted for a condition that has already happened, which the
recipient keeps even after the granter has left the board.

| Event | Cards |
|---|---|
| `onAnyDeath` | Temetkezési vállalkozó |
| `onAllyMove` | **Bodur kapitány** — the moving ally gains a ring |
| `onMustra` | Szarvas — pushes forward at the reveal, onto a finished board; Októ-abnormitás — weighs what to devour then |
| `onLocationWon` (Diadal) | Kincskereső |
| `onLocationLost` (Vigasz) | Makacs élőhalott, Felix |

**Diadal and Vigasz are not death effects.** Both check whether the unit is
standing on the battlefield when the battle is decided: Diadal pays the winner,
Vigasz the loser. On a draw neither fires, because nobody won and nobody lost.
There is deliberately no standalone "when I die" trigger.

The `scope: "trigger"` targeting points at the unit that caused the event.

### Rings (`rings`)

`UnitInstance.rings` is a number. It counts into `power()`, does **not** depend
on the granter, and shows on the board with a ⊙ mark. Its sources: the
`grantRing` effect (Bodur, Temetkezési vállalkozó, Szarvas, Hajnalmadár, Azman,
Októ, Lélekszipoly, Vadász, Varjú, Fejvadász, Szerencsejátékos) and Vaskarom,
which is a ring-flagged attachment.

---

## 4. Attachments (a spell on a unit)

Every spell with a lasting effect sits on a unit. `UnitInstance.placed` keeps
every spell placed on it — lasting and one-shot alike — so hovering the unit
fans them all out. The lasting mechanics come through the `attachment` field,
and removing the card removes the effect (Tisztítás, Vedlés, Napéjegyenlőség).

An attachment can carry a `statics` array, so it uses the same fourteen
primitives the units do.

---

## 5. Battlefield effects

| Primitive | Battlefield |
|---|---|
| `flatBonus` | Holdfényes tisztás (+1), Elátkozott rengeteg (−1) |
| `keywordBonus` (`row`, `invert`) | Akáczos |
| `strongestPenalty` | Sikátor |
| `autoHide` | Feketepiac (Csempész), Ködrét (all) |
| `hideCostMod` | Feketepiac |
| `blockedSlots` | A Pék hídja |
| `spellCostMod` | Máguskör |
| `costMod` | Kikötő (Kalóz) |
| `rangeCap` | Ködrét |
| `suppressPositional` | Ködrét (Távolsági) |
| `playFromGraveyard` | Umbra |
| `salvage` | Plázs — Felindori units go to the bottom of the deck at leszerelés |
| `startEffect` | Lingadori könyvtár, Malom, Bőségkert |
| `perCost`, `costAtMostBonus`, `rowBonus`, `schoolSpellpowerBonus` | in reserve, available in the editor |

---

## 6. Spell schools

Six schools: **Mágus, Feketemágus, Harcos, Zsivány, Druida, Bestia.**

Two old names are gone. The `Állat` spell school **merged into Bestia** — every
former "Állat N" spellpower became "Bestia N" — and `Ravaszság` **became
`Zsivány`**, aligned with the order it belongs to. Both live on as *keywords*,
never as spellpower pools.

A spell may name several schools (`schools: string[]`); the caster pays from
one of them, in full. There is no adding across schools or units. Kegyelemdöfés
(Harcos, Zsivány) is one of these.

A card has four keyword columns — Eredet, Rend, Faj, extra tag — which the
engine stores as `origin`, `order`, `race` and `keywords`. `cardKeywords()`
folds all four into a single list, so no filter ever needs to know which column
a word came from.

The `tags` field gives a spell its element: `Tűz`, `Fagy`, `Mesteri`.
Tűzköpeny, Fagypáncél, Explodus and Erif mester reference it.

---

## 7. What deliberately stayed as text

Only one such card is left. The rest got their machinery: the asking effects
got the `Prompt` queue, the trap and the portal their own zones, and the peeks
got `Reveal`, which actually puts the revealed card on screen for whoever is
entitled to see it.

| Card | Why |
|---|---|
| Gouraldir | the Három Ereklye card does not exist in the set |

Mechanised since:

| Card | Primitive |
|---|---|
| Fuedrax | `setTrap` — the spell sits in `state.traps` and fires on whoever steps in; allies included |
| Felix, a Hajnali Utas | `portal` — Vigasz records the tile, leszerelés carries the unit to the next battlefield, cleaned and outside the cap |
| Griff, a hamiskártyás | `handSwap` — two questions: what you take, then what you give back |
| Mágusinkvizítor, Gréta, Leskelődés | `peek` — keeps the revealed cards on the peeking player's screen |
| Fejvadász | `peek` + `ringIfCostlier` — a random card turns out of the hand, and if it costs more than him, it pays a ring |
