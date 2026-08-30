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
npm run sim -- --games 50         # headless balance runner (win rates, BROKEN flags)
npm run sim -- --games 200 --strength fast   # coarse sweep; the bot cannot cast at this budget
npm run mirror / planner    # bot evaluation (see docs/bot.md)
npm run sim -- --games 100 --report reports/run.json   # then:
npm run stats -- reports/run.json                      # → a clickable HTML report
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
| Asking abilities (tutors, hand swaps, traps) | `src/engine/prompts.ts` (Prompt queue, Reveal record) + `src/engine/interactions.ts` (completion handler per prompt kind) — a new asking ability is one prompt kind + one handler |
| Rules disputes, phase order, timing | `docs/szabaly-teljes.md` (numbered, authoritative) → `src/engine/reducer.ts`, `resolve.ts`; `rulebook.test.ts` pins numbered rules |
| Power, statics, positional bonuses | `src/engine/power.ts` (`basePower` vs `power` — see invariants) |
| Slot adjacency, ranges | `src/engine/grid.ts` |
| Game setup, decks, rule config | `src/engine/setup.ts`, `src/engine/cards.ts` (registry + `validateCardSet`) |
| Online play, lobby, relay | `SkartCF/README.md` § *Playing across a room* first; `src/net/` — `protocol.ts`, `room.ts`, `link.ts`, `relayCore.ts` (matchmaking, no socket), `loopback.ts`/`channel.ts`/`socket.ts` (three transports), `match.ts` (`HostMatch` holds the truth, `GuestMatch` a picture); `src/ui/game/Lobby.tsx`; `server/relay.ts` + `npm run smoke` |
| Game screen UI | `src/ui/game/`: `GameView.tsx` (orchestrator: state, undo, beat/reveal clock, bot timer, drag), `LeftRail.tsx` (battlefield card, turn cue, tools, annals), `RightRail.tsx` (counters, piles, ledger), `Hands.tsx` (both hands, hover reading, prompt takeover), `TheatreView.tsx` (banner + played-card panel), `Asking.tsx` (Almanac pile panel, Curtain reveals), `Prologue.tsx` (opening ceremony), `Overlays.tsx` (chronicle, aftermath), `common.ts` (shared props/lookups), `Board.tsx`, `theatre.ts` (state-diff → animation beats), `NewGame.tsx`, `bot.ts` |
| Card rendering | `src/ui/card/model.ts`, `CardFace.tsx`, `card.css` |
| Card editor | `src/ui/editor/CardEditor.tsx`, `fields.tsx` (form generated from schema.ts) |
| Deck building / collection | `src/ui/collection/CollectionManager.tsx`, `src/ui/cardSet.ts` (localStorage overlay) |
| Styling | Per screen, next to the component: `src/ui/theme.css` (tokens, reset, shared vocabulary — loaded first), `menu.css`, `rulebook.css`, `collection/collection.css`, `game/game.css`, `editor/editor.css` |
| In-app rulebook screen | `src/ui/Rulebook.tsx` renders `docs/szabaly-*.md` directly — edit the docs, never the screen |
| Balance simulator | `src/sim/run.ts` — the planner on both seats; read its header for the budget and why it is a wall clock. `src/sim/baseline.ts` is the planner's fallback, not a rival policy |
| Balance reports | `--report x.json` records every match, every action, and the board at the Mustra and the checkout of each battlefield; `npm run stats -- x.json` builds a self-contained page from `src/sim/viewer.html`. Every statistic is derived in the browser from that raw material, so a new question is a new function there and not another run — but only questions the recording can answer. **Power is not in the action log** and never will be: it is computed from statics, position and the battlefield, so it takes a board snapshot, which is why `report.ts` carries `snaps`. A new question about *what a card was worth* is a change to `report.ts` + `run.ts` and a fresh run; anything about *what was decided* is viewer-only. `run.test.ts` pins the snapshots against the totals the engine actually scored |
| Hand size, refills, the draw/discard economy | The hand is a *level* that refills after every play (§2.4.3, §12.11 of `docs/szabaly-teljes.md`), so a draw raises the level and a discard lowers it. `src/engine/effects.ts` (`handLimitOf`/`setHandLimit`/`refillHand`, plus the `draw`/`discard`/`handLimit` handlers) and `refillActor` in `reducer.ts` |
| The bot | `src/bot/` — one player, the planner. `docs/bot-algorithm.md` is the design; `docs/bot.md` says what the deleted trained bot was and why it went |
| Bot redesign (score, plans, combo graph) | `docs/bot-algorithm.md` — the layered plan; built so far: `src/bot/combo.ts` (which cards can matter to each other), `src/bot/theta.ts` (the best plan still available, and `score`), `src/bot/board.ts` (the best board to put down, given theirs), `src/bot/belief.ts` (what they are holding, from the mask only), `src/bot/deck.ts` (what a decklist can never do), `src/bot/draw.ts` (what the refill hands back for a card spent). `npm run combos`, `npm run theta`, `npm run belief` and `npm run decks` measure them |
| Measuring the bot | `npm run mirror` — same deck both seats, so the matchup cancels; `--against baseline\|legacy`, `--no-secure` and friends ablate one change at a time, and it reports fields won **by position in the six**, which is the column that found the last real bug. Cross-deck win rates measure the card set, not the policy |
| Reading the bot's play | `npm run replay -- --seed 7 --decks magus,felindori --seat p1` prints one game from one seat, every decision with the board and hand it was taken from. `npm run planner` reports **wasted casts** — the play-quality number a weak opponent cannot flatter. §13 of `docs/bot-algorithm.md` is what reading a trace found that six scans had not |
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
- **Whoever holds the state redacts it.** `redact(state, viewer)` in
  `src/engine/view.ts` is a security boundary, not a display convenience, and
  `view.test.ts` guards it. Online, the host's browser is the server: it alone
  calls `applyAction`, it validates every action — including its own — against
  `legalActions` membership, and **both** screens render a redacted position so
  nothing in either React tree holds the opponent's hand.
- **A redacted state answers only for its own seat.** `legalActions(redacted,
  theOtherPlayer)` throws, because their hand is blanks and every card lookup
  throws on a blank. Anything reading the far side's cards — `legalActions` for
  them, `bare` mode — must be off online. Hotseat never notices; the online
  screen white-screens.
- **The relay never imports the engine.** It pairs sockets by a six-digit code
  and forwards bytes. Cards stay data and stay local: the host sends its card
  overlay down the room, so no card change ever needs a server redeploy.
- **`docs/szabaly-teljes.md` decides rule disputes.** The engine follows it;
  when they disagree, one of them is a bug and the rulebook usually wins.
  Settled rules are constants, not options (list: SkartCF/README.md
  "Settled rules").
- **One bot, and the simulator runs it.** The trained value function and the
  greedy heuristic are deleted (`docs/bot.md`); the planner is the only player,
  so a balance number and the opponent a person actually faces are the same
  thing. `src/sim/baseline.ts` is the planner's fallback for the phases it does
  not speak for, not a policy anyone chooses.
- **Domain vocabulary is Hungarian** (Belépő, Mustra, Csata, gyűrű, Diadal,
  Vigasz…) and card text is first person. Keep both in any text you write.

## Working style for agents

- **Don't re-derive design rationale from source.** It is written down:
  `SkartCF/README.md` (architecture + judgement calls), `docs/design-notes.md`
  (why the rules are what they are), `docs/abilities.md` (card → primitive map).
- **Batch the edits, then verify once.** Given a list of eight things, make all
  eight changes and run the checks at the end — not `npm test` after each one
  and certainly not `npm run sim`. The suite is the cheap check (~10s); the sim
  is not, and a balance run only means anything once the changes are all in.
- **`npm run sim` is a deliberate act, not a check.** It takes hours, it is
  never part of "did that work", and nothing but a rebalance needs it. Run it
  once, at the end, in the background, and only when the change could move win
  rates. Output goes to stdout — redirect it (`npm run sim -- --games 50 >
  sim.txt`) if it needs reading later, because a backgrounded run buffers and
  shows nothing until it exits. The default strength is `fair` (~27 s a game, and
  eight decks are 28 pairs, so even 50 games apiece is most of a day) because the
  old default gave the planner 10 ms a decision against the 8000 ms it gets on
  the game screen, and a starved planner stops finding its spells before it stops
  finding its units — spell decks read as unplayable. Cut `--games` before
  cutting `--strength`; see the header of `src/sim/run.ts`.
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
