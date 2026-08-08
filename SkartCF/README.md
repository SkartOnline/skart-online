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

## What works right now

- **Hotseat game.** One screen, you control both players. Full location loop:
  commitment with the four stop flags, face-down units, reveal, spell-stack resolution
  with caster/target/destination picks, totaling, six battlefields plus Végtelen puszta
  on a tie.
- **Card editor.** Build units, spells, battlefields, attachments and decks in the
  browser. Effects are picked from a generated form, saved to a local overlay, and are
  immediately playable. Export writes the JSON you commit.
- **Headless simulator.** Plays N games with a greedy policy and reports win rate per
  deck per battlefield against the 75% hard-failure line.

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
  "cost": 4,
  "power": 2,
  "belepo": {
    "target": { "scope": "opposed", "compare": "weakerThanSelf" },
    "effects": [{ "kind": "destroy" }]
  }
}
```

Rebalancing is editing a number in JSON, not editing code.

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
npm run sim -- --games 500 --decks value,swarm
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

## Open rulings, and where they live in code

The rules document leaves several questions for playtest. None of them is hardcoded:

| Question | Where |
|---|---|
| Unit deck 30 or 40 | `RuleConfig.unitDeckSize`, switch on the setup screen |
| Melee front-row +1 or +2 | `RuleConfig.meleeFrontBonus`, same place |
| More than one hidden unit per location | `RuleConfig.maxHiddenPerLocation` |
| Hiding with no spare card to pay | `RuleConfig.allowHideWithoutSpare`, default off |
| Does a transformed unit keep its abilities | `keepAbilities` on the `transform` effect, default off |

## Known gaps and judgement calls

- **Face-down units are resolved against their true values.** A Belépő landing into a
  column checks the actual card sitting across from it even while it is face-down. The
  alternative — treating a concealed unit as untargetable — would make hiding far
  stronger than the rules intend.
- **The archmage's printed power.** The rules doc says power 3 in the cost-curve section
  and power 2 in the caster-pricing paragraph. `fomagus` uses power 2, cost 7,
  spellpower 7.
- **Ogre is cost 4, power 6**, following the explicit "cost is decoupled from power"
  example rather than the tier table's cost-6 row.
- **`grantImmunity` schools Tűz and Fagy have no spells yet.** Tűzköpeny and Fagypáncél
  work, they just have nothing to protect against until fire and frost spells exist.
- **Végtelen puszta's first player** is picked at random at setup; the rules do not say
  who goes first there.
