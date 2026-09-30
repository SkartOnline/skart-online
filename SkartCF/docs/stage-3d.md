# The 3D stage — plan

A stylised low-poly battlefield in place of the tile grid: real ground, unit
models standing on the twelve tiles, spells that fly across the arcvonal. **No
rule changes.** The engine, the simulator, the bot, online play and the card
data stay exactly as they are; this is a second way of drawing `GameState`.

Nothing here is built yet. This document is the plan and the seams it hangs on.

---

## 1. Why this is a renderer swap and not a rewrite

Three things already in the tree make it cheap:

1. **`Board` has a small, presentational interface.** It takes
   `state, open, onPick, bare, viewer, stirring, fallen, marks, onInspect` and
   nothing else (`src/ui/game/Board.tsx`). A `Stage` taking the *same props* is
   a drop-in in `GameView.tsx`, one `<Board>` line to switch.
2. **The theatre already turns diffs into beats.** `beatsBetween` in
   `theatre.ts` emits `land`, `veil`, `reveal`, `march`, `strike`, `fall`,
   `cast` with the tiles involved (`slot`, `targetSlot`, `destinationSlot`,
   `stepTo`), and `BEAT_MS` / `BEAT_LEAD` / `BEAT_GAP` already sequence them.
   The 3D stage plays the same beats with models instead of CSS classes. It
   invents no timing of its own.
3. **`boardAsOf` holds the board back until each beat's moment.** The stage
   renders `shown`, exactly like `Board` does, so a Belépő's victim is still
   standing when the strike arrives.

## 2. The load-bearing trick: keep the tiles in the DOM

The drag, the flights, hover inspection and accessibility all find tiles with
`document.querySelector('[data-slot=…]')` and `elementFromPoint(…).closest('[data-slot]')`
(`beginCardDrag`, `flyTo`, `slotElement` in `theatre.ts`). Rewriting all of that
as raycasting would touch the most fiddly code in the game.

So we don't. The stage is two layers:

- **The canvas**, behind: ground, tiles, models, VFX. It is not interactive.
- **A tile layer**, in front: twelve transparent `<button data-slot>`s, each
  absolutely positioned over its tile's *projected* screen rectangle, carrying
  the same `open` / `hot` / `aria-disabled` / hover handlers `Cell` does today.

The camera is fixed (see §5), so the projection only changes on resize: twelve
rects, recomputed on `ResizeObserver`. With that in place, drag-to-play,
tap-to-play, the card flight landing on a tile, the loupe and keyboard focus
all keep working **unchanged**.

The same layer carries the **HUD**: power, wounds, rings, the status icons.
`Marks` and `Status` in `Board.tsx` get exported and reused as they are, pinned
to each tile's projected rect. Numbers stay crisp DOM text, not textures, and
the green/red power blush comes along for free.

## 3. Invariants for the stage

- **The stage reads only what `Board` reads.** Same props, same redacted
  `shown`. A face-down unit arrives as a blank with no card id, so it gets the
  generic *veiled* model, and nothing in the scene may call `cardOf` on it.
  `redact` stays the security boundary; the scene is no exception online.
- **Beats remain advisory.** The scene always converges on the true position.
  An animation interrupted by the next action snaps to where the state says the
  unit is.
- **Timing lives in `theatre.ts`.** If a 3D animation needs longer, change
  `BEAT_MS` for both renderers. Never let the stage stretch a beat on its own.
- **Cards are still data.** Unit looks and spell visuals are keyed by data
  (`race`, `tags`, spell `schools`, effect `kind`) with an optional per-card
  override *file*. There is no `if (card.id === …)` in the stage.
- **The 2D board stays.** It is the fallback when WebGL is missing, the choice
  for anyone who prefers it, and what reduced-motion users get if the 3D
  version can't honour it cleanly.
- **Desktop-first, phone at the foot.** Same rule as the stylesheets: the phone
  quality tier is a separate branch, never a compromise to the desktop scene.

## 4. Stack

- `three` + **`@react-three/fiber` v8** + `@react-three/drei` v9. Fiber v9
  needs React 19; the project is on 18, and upgrading React is not part of
  this job.
- `postprocessing` (through `@react-three/postprocessing`) for bloom on spells.
  Desktop only.
- **Lazy-loaded.** `Stage` is a `React.lazy` chunk, so the 2D game, the editor,
  the collection and the rulebook never download three.js. Expect roughly
  200–300 KB gzipped in that chunk, which GitHub Pages serves fine.
- Models are **glTF (`.glb`)**, flat-shaded, coloured from one shared palette
  texture. Palette swap per unit is then a UV offset, not a new model.

New code lives in `src/ui/stage/`:

| File | Job |
|---|---|
| `Stage.tsx` | Canvas + tile layer; same props as `Board` |
| `TileLayer.tsx` | The projected DOM buttons and HUD (§2) |
| `layout.ts` | Slot → world position, camera, projection. Pure |
| `looks.ts` + `looks.json` | Unit → archetype, palette, prop, scale. Pure, tested |
| `motion.ts` | Beat → timeline of model animations. Pure, tested |
| `vfx.ts` | Effect kind → spell motif, school → colour. Pure, tested |
| `Unit.tsx`, `Spell.tsx`, `Ground.tsx` | Scene pieces |
| `models/<archetype>.glb`, `models/<cardId>.glb` | Drop-in art, same convention as `src/ui/art/` |

## 5. Camera and layout

A fixed three-quarter view from the viewer's side, the viewer's half near,
mirrored for `p2`, the same rule `Board` follows. No orbit. A free camera is
where legibility dies and the DOM tile layer stops being cheap. Allowed motion:
a slow sweep when a battlefield turns over (`battlefield` beat), and a small
push-in on a `cast`. Both run inside the beat window.

The grid is the real one: two sides × two ranks (F, B) × three columns, twelve
tiles, the arcvonal between the front ranks. Szakadék (`isBlocked`) tiles are a
missing ground chunk, and traps are a marked tile, with the spell name shown to
the owner only, exactly as `Cell` does.

## 6. Units: 89 of them, so archetypes

Hand-modelling 89 units is the one thing that could sink this. The plan is
~8–10 **archetype** models, each unit a variation:

| Archetype | Draws from |
|---|---|
| Foot soldier | `harcos`, `polgar`, `vasgarda` deck |
| Rogue / assassin | `orgyilkos`, `csempesz`, `kaloz` |
| Caster (robed) | `caster`, `druida` |
| Felindori | `felindori` |
| Beast, small | race `Állat`, `swarm` |
| Beast, large | race `Bestia`, `beast` |
| Dragon | race `Sárkány` |
| Construct / undead | race `Élettelen`, `elettelen` |
| Eastern warrior | `keleti` |
| Veiled | any face-down unit: a cloaked silhouette, identical for all |

`looks.ts` resolves a unit's look as: explicit entry in `looks.json` → derived
from `race` / `tags` → generic fallback. The per-unit variation is palette,
one held prop (sword, staff, bow, dagger, banner), scale (a higher printed
power stands taller), and an optional hat or cloak. A unit that deserves its
own model gets `models/<cardId>.glb` and nothing else changes.

**Animation starts procedural.** Low-poly reads well with tweened motion: idle
bob, a lunge, a flinch, squash on landing, tip-over-and-dissolve on death. That
needs no rigging and covers every archetype at once. Skeletal clips (idle,
walk, cast, hit, die) come later, for the archetypes that earn them.

## 7. Beats → what the stage does

| Beat | 2D today | 3D |
|---|---|---|
| `land` | `stir-land` | Model drops onto the tile, dust ring, a little squash |
| `veil` | `stir-veil` | Cloaked silhouette rises out of the tile |
| `reveal` | `stir-reveal` | Cloak burns or blows away, the real model underneath |
| `march` | `stir-march` | Walks or hops along the path to the new tile |
| `strike` | `stir-strike` | Flinch, hit spark, wound chip ticks up |
| `fall` | `pyre` ghost | Topples and dissolves, driven by `fallen` as today |
| `cast` | `mark-caster/foe/friend` rings | Caster's cast pose → spell VFX (§8) → target reacts; ring decals keep the caster / foe / friend colours |
| `battlefield` | banner | Banner stays DOM; ground re-dresses under a camera sweep |
| `step`, `done` | banner | Unchanged, DOM |
| `draw`, `toss` | card-back flights | Unchanged, DOM; they are hand events, not board events |

`motion.ts` turns the live beats and `now` into "unit X is at phase p of clip
Y", a pure function in the shape of the `stirring` / `marks` memos already in
`GameView`, and unit-testable the same way `theatre.test.ts` tests beats.

## 8. Spells: ~10 motifs, not 102 animations

The 102 spells use 31 effect kinds. Grouped by what they *look* like:

| Motif | Kinds |
|---|---|
| Bolt and impact | `damage`, `sacrificeStrike`, `duel`, `forceAttack` |
| Doom | `destroy`, `massDestroy` |
| Boon | `modifyPower` (+), `grantRing`, `massRing` |
| Hex | `modifyPower` (−), `stealRing` |
| Ward | `grantImmunity`, `fizzleShield`, `lock` |
| Shove | `move`, `advance`, `swapWithAdjacent` |
| Bind | `attach`, `moveAttachment`, `clearPlaced` |
| Rebirth | `revive`, `summon`, `transform`, `transformFromHand` |
| Snare | `setTrap` |
| Hand and deck | `discard`, `stealCard`, `returnToHand`, `searchDeck`, `peek`, `drawNextLocation`: a small caster flourish; the real feedback is the existing DOM reveal |

**Colour comes from the school**, all six of them (Mágus, Druida, Feketemágus,
Bestia, Harcos, Zsivány). A multi-school spell blends two. That is 10 motifs ×
6 tints, each motif a particle system plus maybe a mesh, parameterised by
source, target and colour. `vfx.ts` maps a spell to a motif by reading its
first effect's `kind` from the card data. A new kind added to `schema.ts` falls
back to *bolt* until someone gives it a motif, so the engine never learns the
stage exists.

## 9. Battlefields

15 locations. The field already keys its palette off `data-bf`, and
`ambienceFor` keys the sound, so the stage keys its ground the same way: a
colour ramp, a sky or fog tint, and 3–6 props (rocks, ruins, trees, a bridge
for Pék hídja) scattered off the tiles. That's cheap per location and can
start as colour only.

## 10. Phone, performance, fallbacks

- `frameloop="demand"`: the canvas renders only while a beat is playing or the
  idle bob is on. A card game sitting on a turn should not cook a phone.
- Phone tier (`max-width: 700px`): device pixel ratio capped at 1.5, no
  post-processing, a third of the particles, no idle bob. The phone layout
  (drawers, dock, rotate gate) is untouched, because the stage only replaces
  what is inside `.arena`.
- No WebGL, or context lost → render the 2D `Board`, silently.
- `prefers-reduced-motion` → models snap, VFX shrink to the ring decals the 2D
  board already uses.
- The setting: a *3D board* toggle in the tools, stored in `localStorage` as a
  per-device convenience. It defaults to off until phase 1 reaches parity.

## 11. Testing and verification

- `looks.ts`, `motion.ts`, `vfx.ts` and `layout.ts` are pure and get vitest
  suites. That is where the logic is.
- The tile layer is DOM, so its behaviour (the right tiles `open`, drops
  dispatching the right action, hidden units reporting nothing on hover) is
  checkable with the same tools as the 2D board.
- The canvas can't be verified by the agent: the in-app browser pane renders
  no frames. The scene graph can be inspected through fiber, but **what it
  looks like is checked by a human** at the end of each phase.
- CI stays as is: `npm test` + build. The lazy chunk builds with the rest.

## 12. Phases

Each phase ends playable, with the 2D board one toggle away.

**0 — Spike.** Install the stack, lazy `Stage`, twelve flat tiles, fixed
camera, the projected tile layer, units as coloured boxes. *Exit:* a whole
hotseat game can be played on it by drag and by tap, and online as the guest.
**This is the go/no-go on the idea.**

**1 — Parity with placeholders.** Primitive archetype stand-ins (capsule-and-cone
people, box beasts), the HUD reused from `Board`, every beat in §7 with
procedural motion, fallen ghosts, cast rings, traps, szakadék, veiled units,
battlefield colour per location, the toggle, the WebGL and reduced-motion
fallbacks, the phone tier. *Exit:* everything the 2D board tells you, the 3D one
tells you too.

**2 — Art direction and archetypes.** One style sheet (palette, silhouette
rules, poly budget ~300–1500 tris a unit), the palette texture, the 8–10
archetype `.glb`s, `looks.json` filled in for all 89 units. *Exit:* no unit on
the board is a placeholder.

**3 — Spell VFX.** The ten motifs, school tints, projectile arcs, the mass
variants, bloom on desktop.

**4 — Battlefields and polish.** Props per location, lighting, camera moves,
skeletal clips where procedural motion looks cheap, then deciding whether 3D
becomes the default.

Phases 0–1 are code. 2–4 are mostly art. The limit there is how many models
someone can make, or how far primitives plus good colour and lighting can go
before anyone has to.

## 13. Risks

- **Art volume.** 89 units is the budget line. The archetype system is the
  mitigation. Resist per-card models until all 89 have a decent generic look.
- **Legibility.** A lovely board where you can't tell a 5 from a 7 has lost
  the game. The HUD is DOM on purpose and reviewed before anything pretty.
- **Hover on touch.** The loupe needs a long-press on the tile layer on
  phones. That is the one new input behaviour the stage adds.
- **Scope creep.** Orbit cameras, per-card cinematics and destructible terrain
  are all out. The beat budget in `theatre.ts` is the ceiling on spectacle.

## 14. Open questions

- The camera angle: steep (board-game, easy to read) or shallow (diorama,
  prettier). Settle it in phase 0 with two presets.
- Whether the unit's *card* still appears on the tile somewhere (a small
  banner or plinth) or only in the loupe.

Settled: **models are made in Blender** and exported as `.glb`. The teaser in
`trailer/build.py` (repo root) is the first sketch of the look: every piece
there is a scripted primitive, so its units, portal and tiles are a reference
for proportions and palette, not assets to ship.
