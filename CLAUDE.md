# CLAUDE.md

Skart 2: a two-player tactical card game. All live code is in `SkartCF/` —
TypeScript, React, Vite, no game engine. `SkartTG` (the old Godot build) was
removed from the tree and lives at the git tag `skarttg-archive`; never look
for it on disk.

Read this file plus the doc named in the map below before opening source files.
`SkartCF/README.md` is the deep architecture walkthrough — read it when changing
engine semantics, not for routine card or UI edits.

## Commands

All run from `SkartCF/`:

```
npm run dev         # http://localhost:5173 — hotseat game + card editor
npm test            # vitest, the engine suite; fast, run it after engine edits
npm run typecheck   # tsc --noEmit
npm run sim -- --games 2000        # headless balance runner (win rates, BROKEN flags)
npm run train / arena / balance / cardstats   # bot training & evaluation (see docs/bot.md)
```

CI (`.github/workflows/pages.yml`): every push to `main` touching `SkartCF/`
runs tests + build and publishes to GitHub Pages. A broken `main` is a broken
public site.

## Task → where to look

| Task | Files |
|---|---|
| Card stats/text/abilities (data only) | `src/data/units.json`, `spells.json`, `locations.json`, `attachments.json`, `decks.json` — keyed by `id` |
| What primitive implements a card text | `docs/abilities.md` (every card traced to its effect kind) |
| New/changed effect kind | `src/engine/schema.ts` (KindSpec) + `src/engine/effects.ts` (handler) — exactly these two, editor UI and validation follow for free |
| Rules disputes, phase order, timing | `docs/szabaly-teljes.md` (numbered, authoritative) → `src/engine/reducer.ts`, `resolve.ts`; `rulebook.test.ts` pins numbered rules |
| Power, statics, positional bonuses | `src/engine/power.ts` (`basePower` vs `power` — see invariants) |
| Slot adjacency, ranges | `src/engine/grid.ts` |
| Game setup, decks, rule config | `src/engine/setup.ts`, `src/engine/cards.ts` (registry + `validateCardSet`) |
| Game screen UI | `src/ui/game/`: `GameView.tsx` (orchestrator: state, undo, beats, bot timer, drag), `LeftRail.tsx` (battlefield card, turn cue, tools, annals), `RightRail.tsx` (counters, piles, ledger), `Hands.tsx` (both hands, hover reading), `TheatreView.tsx` (banner + played-card panel), `Overlays.tsx` (chronicle, aftermath), `common.ts` (shared props/lookups), `Board.tsx`, `theatre.ts` (state-diff → animation beats), `NewGame.tsx`, `bot.ts` |
| Card rendering | `src/ui/card/model.ts`, `CardFace.tsx`, `card.css` |
| Card editor | `src/ui/editor/CardEditor.tsx`, `fields.tsx` (form generated from schema.ts) |
| Deck building / collection | `src/ui/collection/CollectionManager.tsx`, `src/ui/cardSet.ts` (localStorage overlay) |
| Styling | Per screen, next to the component: `src/ui/theme.css` (tokens, reset, shared vocabulary — loaded first), `menu.css`, `rulebook.css`, `collection/collection.css`, `game/game.css`, `editor/editor.css` |
| In-app rulebook screen | `src/ui/Rulebook.tsx` renders `docs/szabaly-*.md` directly — edit the docs, never the screen |
| Balance simulator | `src/sim/run.ts`, `src/sim/policy.ts` (deliberately dumb; consistency over strength) |
| Learning bot | `src/bot/` — `docs/bot.md` first; `agent.ts`, `features.ts`, `observe.ts`, `model.ts`, `learn.ts`, `selfplay.ts`, `train.ts` |
| Card art | drop `src/ui/art/<cardId>.webp` — nothing else to change |

## Invariants — do not break

- **`src/engine/` is pure and has zero React imports.** React renders state and
  dispatches actions, nothing more. This is what makes the headless simulator
  possible; it is the core architectural bet.
- **Cards are data, never code.** No card-specific branches anywhere in the
  engine. A card is JSON naming an effect `kind` plus parameters. If a card
  seems to need code, it needs a new parameterised kind or a new value in the
  shared condition enum.
- **`basePower(unit)` is the printed value; `power(unit, state)` is the full
  computed value.** Statics are computed on read inside `power()`, never applied
  as state mutations. A static handler must never call `power()` (recursion).
  Every effect declares which accessor it reads, taken from the card text.
- **Damage is not a power debuff.** Damage accumulates and only matters when it
  reaches current power (`isDead()`); `modifyPower` shifts the total
  immediately. Keep them apart.
- **Auto-close rules live in the engine, not the UI**, so the simulator and the
  hotseat screen always agree on legal actions.
- **`docs/szabaly-teljes.md` decides rule disputes.** The engine follows it;
  when they disagree, one of them is a bug and the rulebook usually wins.
  Settled rules are constants, not options (list: SkartCF/README.md
  "Settled rules").
- **Only `src/bot/weights/latest.json` is tracked.** Everything else in
  `weights/` is local training scratch — never commit it, never delete it
  unasked.
- **Domain vocabulary is Hungarian** (Belépő, Mustra, Csata, gyűrű, Diadal,
  Vigasz…) and card text is first person. Keep both in any text you write.

## Working style for agents

- **Don't re-derive design rationale from source.** It is written down:
  `SkartCF/README.md` (architecture + judgement calls), `docs/design-notes.md`
  (why the rules are what they are), `docs/abilities.md` (card → primitive map).
- **Rebalancing is editing JSON**, then `npm run sim` to measure. Any deck over
  75% on a battlefield is the hard failure line.
- **Delegate to subagents freely:** running sim/train/arena sweeps and
  summarising output, card-data edits (validated by `validateCardSet` /
  `npm test`), test runs, doc lookups. Keep in the main context: engine
  semantics, rules interpretation, anything touching `schema.ts`/`effects.ts`.
- **Large files** — search within rather than reading whole: `effects.ts`
  (~45 KB), `engine.test.ts` (~42 KB), `units.json` (~47 KB), `schema.ts`
  (~39 KB), `power.ts` (~35 KB), `game/game.css` (~30 KB).
- Commit messages here are one wry sentence about what changed and why —
  match the `git log` voice.
