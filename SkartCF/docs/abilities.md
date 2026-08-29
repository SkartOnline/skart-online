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
`swapWithAdjacent`, `transform`, `transformFromHand`, `attach`,
`moveAttachment`, `grantImmunity`, `fizzleShield`, `lock`, `summon`,
`thresholdAoe`, `grantRing`, `massRing`, `stealRing`, `duel`, `devour`,
`advance`, `sacrificeStrike`, `forceAttack`, `modifySpellpower`,
`revealHidden`, `clearPlaced`.

The amount of `damage` can come five ways: `amount` is the fixed number;
`altAmount` + `altIf` is the second number when the condition holds for the
targeted unit (Hátbaszúrás: 1, or 4 in the back row); `casterPowerDiv` derives
it from the caster's power; `source: "load"` counts what is already lying on
the target — spells, damage markers and rings alike (Lélektűz); and
`source: "powerGap"` is how far the caster's power overtops the target's
(Eltaposás), never below zero. `minimum` floors whichever of those came out,
which is what stops Eltaposás being a four-cost spell for one damage when the
two are nearly matched.

`powerGap` goes with `weakerThanCaster` on the target spec, the same filter
Marcangolás uses: you trample things smaller than you, so a stronger enemy is
not a legal target rather than a legal target that does the minimum.

A `fizzleShield` with `maxCost: 0` means **no** cost limit, and both things
that grant one — Omnifex and the Álomfogó card — write zero. The card text is
"a következő őt érő varázslat hatástalan": the next one, whatever it cost.

### What the physical game rules out

Skart is also a table game, and two whole families of effect did not survive
that:

- **No area damage.** Damage is a card that stays on the unit, and handing out
  four of them at once is bookkeeping nobody wants. Mass removal is fine —
  `massDestroy` reads the board once and the dead leave — but "sebezz 2-t
  mindenkibe" does not exist and will not.
- **No effect that leaves a modifier on two or more units.** One exception,
  and it is exactly one: the gyűrű. `massRing` hands a token to every unit on
  a side and is never recalculated afterwards, which is why Kivirágzás can be
  a card and "minden szövetséges +1 erőt kap" cannot. `thresholdAoe` survives
  in the schema for units and battlefields; **no spell uses it**, and
  `physical.test.ts` pins that.

Damage therefore lives twice on the unit: `damage` is the total every death
check reads, and `damageMarks` is the same damage itemised, one entry per hit.
That second list is what Gyógyfüvek lifts a card off (biggest first, the only
deterministic reading of "one of them") and what Lélektűz counts.

Armour is a **subtraction**, not a cap: `damageReduction` on an attachment
(Fagypáncél 1, Pajzs 2) comes off every incoming application before A Faarcú's
`damageCap` shaves it. A ward therefore blanks a swarm of small hits entirely
while a Lánglándzsa barely notices.

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
| `setTrap` | which spell goes down, and onto which enemy tile | Fuedrax, Csapdaállítás |
| `coinFlip` | after a win, whether to throw again | Szerencsejátékos |
| `transformFromHand` | which unit steps in off the bench | Metamorfózis, Monstrosis |

A trap's **tile is public, its contents are not.** Both players see that
something is buried there; only the owner is told which spell. A trap nobody
can see is a gotcha, and one everybody can read is a fence — showing the tile
and hiding the card makes walking onto it a decision.

Three effects ask for a second pick that is a *neighbour* rather than an empty
tile, and `destinationsFor` in `resolve.ts` is where that is decided:
`sacrificeStrike` wants an enemy of the sacrifice (Megtorlás), `forceAttack` an
ally of the confused unit (Elmezavar), `moveAttachment` anyone next door
(Transzfúzió).

These put a `Prompt` on the queue (`prompts.ts`) and stop; until it is
answered, nothing else can happen in the game. The answer arrives as an
ordinary action (`answerPrompt`, `finishPrompt`), so the bot and the simulator
can play these cards without knowing they exist. The completion handler is
keyed by `kind` in `interactions.ts`, never a closure — a prompt has to
survive the `structuredClone` the bot uses to evaluate positions.

A prompt normally picks a card out of a listed pile or a tile on the board.
`coinFlip` is the third shape: `picking: "option"`, a short list of `options`
each with an `id` and a label, answered by id through the same `answerPrompt`.
Use it for a question that is about neither a card nor a tile — press on or
stop, take it or leave it.

These are the first asking effects, not the only ones the machinery is
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
which is a ring-flagged attachment. `grantRing` also takes a `per`: `keyword`
counts the matching allies on the board (Falkavezér), `graveyard` counts the
pile (Csontvért), and `targets` counts what the ability actually reached —
which is how a ring can be the *price* of something. Azman uses it: he pays +4
for the unit he sacrifices, and standing in the back row with nothing behind
him he sacrifices nothing and is paid nothing.

---

## 4. Attachments (a spell on a unit)

Every spell with a lasting effect sits on a unit. `UnitInstance.placed` keeps
every spell placed on it — lasting and one-shot alike — so hovering the unit
fans them all out. The lasting mechanics come through the `attachment` field,
and removing the card removes the effect (Tisztítás, Vedlés, Napéjegyenlőség).

An attachment can carry a `statics` array, so it uses the same primitives the
units do — including `scope: "self"`, which is what lets a guardian static
watch over nobody but its own wearer (Oltalom's `powerFloor`) instead of
leaking onto the neighbours.

Two fields belong to attachments alone: `damageReduction` (Fagypáncél, Pajzs)
subtracts from every incoming hit, and `bounty` (Vérdíj) pays whoever kills the
wearer. The bounty finds its killer through `state.currentCaster`, which the
unit resolving something owns for the length of that resolution — a unit that
starves between spells collects nobody, which is the point.

---

## 5. Battlefield effects

| Primitive | Battlefield |
|---|---|
| `flatBonus` | Kesergő (−1) — a bonus recomputed on every read, gone when the battlefield is |
| `entryRing` | Oppidium (+1) — a ring handed out at the door, and the unit's own from then on (9.4) |
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
| `startEffect` | Lingadori könyvtár, Malom, Faloda |
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

`schools` is the sheet's **Rend** column: who may cast it. `tags` is the
sheet's **Tipus** column: what it is. Every spell carries exactly one Tipus,
plus `Mesteri` where the grade applies, and `physical.test.ts` pins that too.

| Tipus | What lands here |
|---|---|
| `Támadás` | a physical strike — Kardcsapás, Hátbaszúrás, Párbaj, Rozzant gránát |
| `Képesség` | non-magical and not a strike — Manőver, Testcsel, Leskelődés, Morál |
| `Felszerelés` | gear that stays on a card — Acélpenge, Kötél, Pajzs, Füstbomba |
| `Tűzmágia` | Explar, Lánglándzsa, Lélektűz, Sárkánytűz |
| `Fagymágia` | Fagypáncél, Fagyos lehelet, Jéghegy |
| `Természeti erő` | weather, growth, shapeshifting — Villámcsapás, Széllökés, Metamorfózis |
| `Portálmágia` | Teleport, Idézés, Enormorf, Valóságtörés |
| `Feketemágia` | death, decay, and every mind-control or transform-someone-else — Argeo, Csábítás, Elmezavar, Lépumorf |
| `Mesteri` | a grade, never alone: always a second tag on top of the element |

Tűzköpeny, Fagypáncél, Oltalom, Explodus and Erif mester all reference Tipus,
which is why `grantImmunity` takes a comma-separated list (Tűzköpeny wards
against Tűz **and** Fagy).

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
