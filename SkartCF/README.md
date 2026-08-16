# SkartCF

Browser prototype for **Skart 2**: a two-player tactical card game where you fight for
locations one at a time, committing units under a cost cap while feeding a hidden spell
stack, then the stack resolves and the boards are compared.

This folder is the new direction. It shares no code with `../SkartTG`, which is kept
only for preservation.

```
npm install
npm run dev        # http://localhost:5173 — hotseat game + card editor
npm test           # engine test suite
npm run sim -- --games 2000
npm run build      # static build into dist/
```

## The card set

The full set is in: **88 units, 59 spells, 15 battlefields**, plus 21 attachment cards
and one token (the Nyúl a Lépumorf leaves behind). `docs/abilities.md` is the ability
inventory — every card text traced back to the parameterised primitive that implements
it, and the short list of abilities that deliberately stayed as flavour text.

Three things about this set are worth knowing before you read the data:

- **Six schools: Mágus, Feketemágus, Harcos, Ravaszság, Druida, Bestia.** The old `Állat`
  *caster school* was folded into Bestia. `Állat` survives as a keyword (Eredet) and is
  still a different thing from the `Bestia` origin.
- **A spell may name more than one school** (`schools: ["Harcos", "Ravaszság"]`). One
  caster covers the whole cost out of one pool — naming two schools widens who *can*
  pay, it never adds two pools together.
- **Eredet and Rend are keywords.** `origin` and `order` are separate fields for the
  editor's sake, but `keywordsOf()` folds them into the same list every filter reads, so
  "minden szövetséges Kalóz" needs no special case.

## What works right now

The site opens on a main menu with three ways in.

- **Játék** — hotseat. One fixed-viewport screen, no page scroll, you control both
  players. Full location loop: commitment with the four stop flags, face-down units,
  reveal, rakás resolution with caster/target/destination picks, totaling, six
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
    resolve.ts    the spell-stack resolution machine, Belépő firing
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
  "spellpower": { "Ravaszság": 3 },
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

Rings come from triggers, which are the other half of the mechanism: `onDeath` (Vigasz),
`onAnyDeath`, `onAllyMove`, `onLocationWon` (Diadal). A trigger is an event name, a
target set and an effect list — the same shape a Belépő has.

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

### The spell stack

Resolution is a machine, not a function call, because casters and targets are chosen
mid-resolution and the choosing player alternates unpredictably. The engine advances
until it needs input, parks a `ChoiceRequest` in `state.resolution.pending`, and stops.
The caller supplies a choice and it advances again.

Fizzle is not a special case: it is "no viable caster", which advances the index without
asking anyone. That is what makes stacking a spell you cannot cast a legal bluff rather
than an error.

### Stop flags

Four booleans, not a turn counter. `legalActions(state, player)` returns an empty array
when both of a player's flags are closed, and the turn loop skips them rather than
ending the phase. The phase ends only when all four are true. Auto-closing (empty hand,
six slots filled, empty spell hand) is applied by the engine, not the UI, so the
simulator and the hotseat agree.

## The simulator

```
npm run sim -- --games 2000
npm run sim -- --games 500 --decks felindori,bestia
npm run sim -- --games 2000 --stop-margin 0,2,4
```

Reports match win rate, how often games reach Végtelen puszta, and win rate per deck per
battlefield. Any deck over 75% on any single battlefield is flagged `BROKEN` — that is
the hard failure condition from the rules doc, and the number this script exists to
measure.

The policy in `src/sim/policy.ts` is deliberately dumb. Its job is not to play well but
to play *consistently*, so a win-rate gap between two decks is a property of the cards
rather than of the bot. `stopMargin` and `stopChance` are the parameters worth sweeping,
since "when do I stop" is the most important decision in the game.

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
  own. A unit can still go down before the spell in the same turn.

Still genuinely open, and still a switch:

| Question | Where |
|---|---|
| Does a transformed unit keep its abilities | `keepAbilities` on the `transform` effect, default off |

## Wording

Cards speak in the first person. A unit describes its own ability — *„+1-et kapok minden
szomszédos szövetséges Állat után."* A spell speaks as whoever is casting it — *„1-et
sebzek egy egységbe."* — because a spell is, in effect, an ability the caster borrows.

**Rakás** is the shared pile both players commit spells into during commitment. The
thirty-card spell deck a player brings is the **varázslatpakli**. They are not the same
thing and the UI never mixes them up.

## Known gaps and judgement calls

- **Face-down units are resolved against their true values.** A Belépő landing into a
  column checks the actual card sitting across from it even while it is face-down. The
  alternative — treating a concealed unit as untargetable — would make hiding far
  stronger than the rules intend.
- **Six units have no printed power in the source spreadsheet** — Sir Ton, Elfina,
  Dérföldi Deoren, Charon, Calcas, A Faarcú. They are in the set at the cost-curve
  baseline (`cost + 1`), tagged `wip`, with the placeholder said out loud in their card
  text. Calcas had no printed cost either and is a guess at 5. Replace the numbers in
  the editor when they are decided.
- **Tűz and Fagy tags were assigned, not printed.** No spell in the spreadsheet names its
  element, so Explar and Lánglándzsa were tagged `Tűz` and Jéghegy `Fagy` from their card
  text. Tűzköpeny, Fagypáncél, Explodus and Erif mester all read those tags, so moving a
  tag moves four cards' worth of behaviour.
- **Belépő abilities that say "one" need a rule for which one.** A Belépő never asks the
  player anything, so `pick` decides: Bérgyilkos takes the `weakest` in its column,
  Carnifex the `strongest` it is allowed to kill, Azman the `weakest` ally, Mágiacenzor
  the `highestSpellpower` enemy in its column.
- **Vízköpő reads "no other ally in my row", not "in the front row".** The printed text
  says első sor while the unit can stand in either, so the condition was read as the row
  it is actually in.
- **Varjú discards two, not "any number".** The card lets the player choose how many; a
  Belépő cannot ask, so it takes the two cheapest units for two rings.
- **Egységben az erő has no front-row restriction.** The printed card asks for the front
  row; the attachment grants +1 to a three-strong row either way.
- **The rules doc contradicts the damage rule.** `docs/rules-v2.md` says "Damage is a
  persistent −X token placed on the unit and summed at totaling." The engine follows the
  later correction instead: damage is not summed at totaling and scores nothing unless it
  kills. The doc line wants updating.
- **Végtelen puszta's first player** is picked at random at setup; the rules do not say
  who goes first there.
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
