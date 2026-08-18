# SkartCF

Browser prototype for **Skart 2**: a two-player tactical card game where you fight for
locations one at a time. Units go down under a cost cap until both players stop, the
board is revealed at Mustra, then the battle opens and spells are traded openly until
both players stop again. Whoever has the higher total takes the location.

This folder is the new direction. It shares no code with `../SkartTG`, which is kept
only for preservation.

```
npm install
npm run dev        # http://localhost:5173 — hotseat game + card editor
npm test           # engine test suite
npm run sim -- --games 2000
npm run build      # static build into dist/
```

## The documents

| File | What it is |
|---|---|
| `docs/szabaly-teljes.md` | **The rulebook.** Numbered, quotable, decides disputes. The engine follows it, and the in-app Szabály screen renders it. |
| `docs/szabaly-gyors.md` | The quick rules, enough to sit down and play. |
| `docs/abilities.md` | Every card text traced back to the parameterised primitive that implements it. |
| `docs/design-notes.md` | Why the rules are what they are, plus the technical notes. Not a rulebook. |
| `docs/bot.md` | The self-play opponent. |

`docs/rules-v2.md` is gone. Its rules half was superseded by the full rulebook; its
design half moved to `docs/design-notes.md`.

## The card set

The full set is in: **88 units, 64 spells, 15 battlefields**, plus 21 attachment cards
and one token (the Nyúl a Lépumorf leaves behind). `docs/abilities.md` is the ability
inventory — every card text traced back to the parameterised primitive that implements
it, and the short list of abilities that deliberately stayed as flavour text.

Three things about this set are worth knowing before you read the data:

- **Six schools: Mágus, Feketemágus, Harcos, Zsivány, Druida, Bestia.** Two old names are
  gone. The `Állat` *caster school* was folded into Bestia, and `Ravaszság` was renamed
  `Zsivány` after the class it belongs to. Both survive as keywords, never as pools.
- **A spell may name more than one school** (`schools: ["Harcos", "Zsivány"]`). One caster
  covers the whole cost out of one pool — naming two schools widens who *can* pay, it
  never adds two pools together.
- **Eredet, Rend and Faj are keywords.** `origin`, `order` and `race` are separate fields
  for the editor's sake, but `cardKeywords()` folds all three into the same list every
  filter reads, so "minden szövetséges Kalóz" and "dobj el egy Állatot vagy Bestiát" need
  no special case and no knowledge of which column the word came from.

## What works right now

The site opens on a main menu with three ways in.

- **Játék** — hotseat. One fixed-viewport screen, no page scroll, you control both
  players. Full location loop: the units phase with its stop flags and face-down units,
  Mustra, the battle phase with caster/target/destination picks, totaling, six
  battlefields plus Végtelen puszta on a tie.
- **Gyűjtemény** — the collection. Build your own decks: thirty units, thirty spells,
  three battlefields. Saved to the browser and live in the deck picker straight away.
  The shipped decks are starting points, nothing more.
- **Kártyaműhely** — the card editor. Units, spells, battlefields and attachments.
  Effects come from a form generated out of the engine's own schema, so what you set is
  exactly what the engine plays.

Not built yet: networked multiplayer, card art, AI worth playing against.

## Architecture

The rules engine is pure functions in `src/engine/`, with **zero React imports**. React
only renders state and dispatches actions. That split is not tidiness — it is what lets
a headless script play ten thousand games and report win rate by battlefield, which is
the actual payoff of building this rather than printing more paper.

```
src/
  engine/
    types.ts      state, card, effect type definitions
    grid.ts       slot adjacency, 12×12 range matrix (BFS, built once)
    schema.ts     declaration of every effect / static / location-effect kind
    cards.ts      the card registry and card-set validation
    power.ts      basePower() and power(), statics computed on read
    effects.ts    one handler per effect kind
    resolve.ts    the spell resolution machine, Belépő firing
    reducer.ts    applyAction(state, action) => state, legalActions()
    setup.ts      createGame(), rule config defaults
    totaling.ts   final board sum
  data/           units, spells, locations, attachments, decks — all JSON
  ui/             React. Game screen and card editor.
  sim/            headless runner and its policy
```

### Cards are data, never code

Every card is a JSON row naming an effect `kind` plus parameters. There are no
card-specific branches anywhere in the engine — `effects.ts` is a table keyed by kind.

```json
{
  "id": "bergyilkos",
  "name": "Bérgyilkos",
  "cost": 5,
  "power": 4,
  "order": "Orgyilkos",
  "spellpower": { "Zsivány": 3 },
  "belepo": {
    "target": { "scope": "columnEnemy", "compare": "weakerThanSelf", "pick": "weakest" },
    "effects": [{ "kind": "destroy" }]
  }
}
```

Rebalancing is editing a number in JSON, not editing code.

The set comes out of fourteen static kinds, thirty-two effect kinds and sixteen location
effects, because the variation lives in the parameters rather than in the table. Five
different "kill a unit" spells are all one `destroy` effect with different target
filters:

| Card | Filter |
|---|---|
| Óriásölő | `minPower: 8` |
| Fojtás | `maxPower: 3` |
| Rajtaütés | `isolated: true` |
| Kegyelemdöfés | `damaged: true` |
| Carnifex (Belépő) | `maxBasePower: 4` |

Two conventions do most of the compression work. Every "+X, ha …" unit is one
`powerBonus` static plus a value from a shared condition enum (`isolated`, `enemyHalf`,
`opposedWeaker`, `graveyardAtLeast`, …), and every effect accepts the same optional `if`
gate off that enum — which is how a Belépő that reads "if nobody else is out there, +2"
stays data instead of becoming a new effect kind.

### Gyűrű

Some abilities grant power for a condition that has *already happened*, and the grantee
keeps it after the granter leaves the board. Bodur kapitány is the example: an ally that
moves takes +1 with it, and Bodur dying does not take it back.

That is a **gyűrű**, and it is a separate number from `powerDelta` for exactly that
reason — `UnitInstance.rings`, granted by the `grantRing` effect, drawn on the card with
a ⊙ mark. Vaskarom is the spell version: an attachment flagged `ring: true`, which wears
the same mark.

Rings come from triggers, which are the other half of the mechanism: `onAnyDeath`,
`onAllyMove`, `onMustra`, `onLocationWon` (Diadal) and `onLocationLost` (Vigasz). A
trigger is an event name, a target set and an effect list — the same shape a Belépő has.

There is deliberately no self-death trigger. Vigasz turned out not to be one, and a
genuine "when I die" effect would have to act on a unit `sweepDead` has already taken off
the board.

### Spells sit on units

Every spell that resolves onto a unit is recorded in `UnitInstance.placed`, whether or
not it left a lasting effect. A lasting one also names an `attachment`, and taking the
card off takes the effect off — there is no duration to track anywhere.

Attachments carry the same `statics` array units do. That is why Falanx, Vérszomj,
Halálfélelem, Csordaszellem and Morál need no code at all: they are a card with one
static on it.

On the board a laden unit shows a `✦n` count and a coloured edge; hovering it fans out
every card lying on it, spent one-shots included.

### Adding a new effect kind

Exactly two edits, in adjacent files:

1. A `KindSpec` block in `src/engine/schema.ts` — label, one-line summary, and the
   parameter fields with their types and defaults.
2. A handler in `EFFECT_HANDLERS` in `src/engine/effects.ts`.

The card editor renders the form from the spec, and `validateCardSet` starts checking
it, both for free. Nothing else needs to know the kind exists.

### The two stat accessors

`basePower(unit)` is the printed value (or a set-power overwrite). `power(unit, state)`
is printed plus positional plus location plus statics plus tokens, clamped at 0. Every
effect declares which one it reads, taken straight from the card text — threshold AoE
and kill checks are where this bites.

Static abilities are never applied as state mutations. They are computed on read inside
`power()`, which is what makes "killing a unit buffs the survivors" fall out for free.
Every static therefore reads only printed values, keywords and slot occupancy — never
`power()`, or the computation would recurse.

### The three phases

A location runs **units → Mustra → battle → scored**, and the phase is the thing that
decides what is playable:

| Phase | What is on offer | Ends when |
|---|---|---|
| `units` | one unit per turn, or *units done* | both `unitsClosed` |
| `mustra` | nothing — it flips the hidden units, fires their Belépő, then Mustra abilities | immediately |
| `battle` | one spell per turn, or *spells done* | both `spellsClosed` |
| `scored` | Diadal and Vigasz have fired; *next location* | — |

The two stop flags belong to different phases and are never live at the same time. That
is the whole shape: `legalActions` returns an empty array for a player who has stopped in
the phase that is running, and the turn loop skips them rather than ending it early.
Auto-closing (empty hand, six slots filled, empty spell hand, an Omen on the board) is
applied by the engine, not the UI, so the simulator and the hotseat agree.

### Spell resolution

Spells are played **open and resolve on the spot**, one per turn. There is no stack and
nothing is face-down: you nominate caster and target as you play it, it goes off, the
turn passes.

Resolution is still a machine rather than a function call, because caster and target are
chosen mid-resolution. The engine advances until it needs input, parks a `ChoiceRequest`
in `state.resolution.pending`, and stops; the caller supplies a choice and it advances
again. `state.spellsCast` is the ordered record of what has been cast, and the resolution
cursor points at the entry currently going off.

Fizzle is not a special case: it is "no viable caster", which advances the cursor without
asking anyone. Under the old face-down stack that made an uncastable spell a legal bluff;
now it is simply a wasted card, which is why the sim's bot no longer plays one.

## The simulator

```
npm run sim -- --games 2000
npm run sim -- --games 500 --decks felindori,bestia
npm run sim -- --games 500 --fold 4
npm run sim -- --games 2000 --policy greedy --stop-margin 0,2,4
```

Reports match win rate, how often games reach Végtelen puszta, and win rate per deck per
battlefield. Any deck over 75% on any single battlefield is flagged `BROKEN` — that is
the hard failure condition from the rules doc, and the number this script exists to
measure.

Three policies can play the games. The default is the **baseline** in
`src/sim/baseline.ts`: deterministic, no randomness anywhere. It computes the
theoretical maximum total it can still reach — through the real engine, so auras and
battlefield effects count — from what a player could actually know (the battlefield,
its own hands, the visible enemy units), builds the strongest board with the fewest
cards, and stops only when the opponent has stopped and the board is won, or when even
the theoretical maximum is `--fold` short of the enemy's total. `--policy greedy` is
the old randomised heuristic (kept as the bot's sparring partner; `--stop-margin`
applies only to it), and `--policy bot` plays the trained model.

## Damage versus power debuffs

These are two different things and the engine keeps them apart.

**A power debuff shifts the comparison.** `modifyPower −3` takes three points off what
the unit contributes at totaling, immediately.

**Damage buys nothing until it kills.** Sebzés accumulates on the unit as a wound count
and does not reduce its power. A unit at 6 power carrying 5 damage still counts 6 on the
scoreboard. It dies the moment damage reaches its current power — so a debuff landing
afterwards can finish what the damage started.

`power()` therefore does not subtract damage; `isDead()` compares the two. Explar is a
damaging spell (`1-et sebzek egy egységbe`), so playing it into a big unit and not
killing it gains you nothing at all.

## Settled rules

These were open questions and no longer are. They are constants, not options, and there
is no UI to change them:

- Unit deck **30**, spell deck 30.
- Positional keywords live in one table, `POSITIONAL_KEYWORDS` in `power.ts`: **Melee**
  front row +1, **Távolsági** back row +2. No unit in the current set carries Melee — the
  Excel never marked any — so the front-row bonus is live code with no cards on it yet.
- **No limit** on face-down units per location — the only gate is being able to pay,
  since hiding discards a unit card and you cannot pay with the last card in hand.
- Playing a spell **ends your turn**: nothing can follow it, so the turn passes on its
  own once the spell has finished asking for picks.
- **Leszerelés is a step you play**, not a book-keeping pass: 12.5 lets both players throw
  away as much of either hand as they like *before* 12.6 refills to seven. Tossing is
  never forced, and it is not free either — you refill from a finite deck, so it buys card
  quality with deck depth.
- Both phases open with the player who **brought the battlefield**. Going first costs
  information in each: on units you reveal intent a step ahead, in the battle you show a
  spell and its target before the reply.

Still genuinely open, and still a switch:

| Question | Where |
|---|---|
| Does a transformed unit keep its abilities | `keepAbilities` on the `transform` effect, default off |

## Wording

Cards speak in the first person. A unit describes its own ability — *„+1-et kapok minden
szomszédos szövetséges Állat után."* A spell speaks as whoever is casting it — *„1-et
sebzek egy egységbe."* — because a spell is, in effect, an ability the caster borrows.

**Mustra** is the reveal step between the two phases. **Csata** is the battle phase that
follows it. The thirty-card spell deck a player brings is the **varázslatpakli**; what
has already been cast this location is shown as **elsült varázslatok**. There is no
*rakás* any more — that was the face-down pile the old design committed spells into, and
nothing in the engine plays that role now.

## Known gaps and judgement calls

- **Face-down units are resolved against their true values.** A Belépő landing into a
  column checks the actual card sitting across from it even while it is face-down. The
  alternative — treating a concealed unit as untargetable — would make hiding far
  stronger than the rules intend.
- **Three units still have no printed power in the source spreadsheet** — Dérföldi
  Deoren, Charon, Calcas. They are in the set at the cost-curve baseline (`cost + 1`),
  tagged `wip`, with the placeholder said out loud in their card text. Calcas had no
  printed cost either and is a guess at 5. Replace the numbers in the editor when they
  are decided. Sir Ton, Elfina and A Faarcú have been finished and are no longer `wip`.
- **Tűz and Fagy tags were assigned, not printed.** No spell in the spreadsheet names its
  element, so Explar and Lánglándzsa were tagged `Tűz` and Jéghegy `Fagy` from their card
  text. Tűzköpeny, Fagypáncél, Explodus and Erif mester all read those tags, so moving a
  tag moves four cards' worth of behaviour.
- **Belépő abilities that say "one" need a rule for which one.** A Belépő never asks the
  player anything, so `pick` decides: Bérgyilkos takes the `weakest` in its column,
  Carnifex the `strongest` it is allowed to kill, Azman the `weakest` ally, Mágiacenzor
  the `highestSpellpower` enemy in its column.
- **Varjú discards "any number" by discarding all of it.** The card lets the player
  choose how many; a Belépő cannot ask, so it empties the unit hand and keeps a ring per
  card. Vadász and Chupacabra pick the cheapest for the same reason.
- **The cost cap is enforced at placement, not audited at Mustra.** 7.4 has the cap
  checked at the reveal, with the whole battlefield forfeit for overshooting it. The
  engine makes overshooting illegal instead, so the bust can never happen: it is the only
  thing that has to be enforced and the only thing a player needs to know, and it keeps
  the sidebar from having to show a number that 1.5.3 calls hidden.
- **Októ-abnormitás devours at Mustra.** The spreadsheet dropped its `Belépő:` prefix and
  the ability weighs the units diagonally touching it, which wants a finished board — so
  it reads the board at the reveal step, the timing 10.2 exists for.
- **Omen says "nem lehet varázslatot kijátszani".** The printed card still says *a
  rakásra*, a zone the rules no longer have; the effect is unchanged.
- **1.3.6's knockout tiebreak is not implemented.** Total power across the battles decides
  who advances in an elimination bracket; a friendly game just ends in a draw.
- **Végtelen puszta's first player** is picked at random at setup, which is what 3.8 asks
  for ("sorsolással").
- **Five abilities are text only.** Fuedrax's trap zone, Felix's portal to the next
  battlefield, Gouraldir's Three Relics (the card does not exist in the set) and Griff's
  two-way hand swap all need machinery the engine does not have; the pure-information
  plays (Greta, Mágusinkvizítor, Leskelődés) write to the chronicle and nothing else,
  since hotseat already has a "Mindent mutat" switch. Each one carries a `note` effect
  saying so, and they are listed at the end of `docs/abilities.md`.
- **The shipped decks are starting points.** Five archetypes — Felindori sereg,
  Csempészgyűrű, Varázslótanács, Vadállatok, Élettelen menet — assembled to exercise the
  set, not balanced. The simulator already flags a couple of battlefields over the 75%
  line; that is tuning work, not a bug.
