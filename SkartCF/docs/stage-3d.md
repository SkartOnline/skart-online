# The 3D stage — plan

A stylised low-poly battlefield in place of the tile grid: real ground, unit
models standing on the twelve tiles, spells that fly across the arcvonal. **No
rule changes.** The engine, the simulator, the bot, online play and the card
data stay exactly as they are; this is a second way of drawing `GameState`.

**Phases 0 and 1 are built** (`src/ui/stage/`, the *3D* button in the tools
rail or the chronicle panel); phases 2–4 are still plan. See §12 for what
each phase found.

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

## 4. Stack and the art pipeline

- `three` + **`@react-three/fiber` v8**. Fiber v9 needs React 19; the project
  is on 18. drei was never needed.
- **Lazy-loaded.** `Stage` is a `React.lazy` chunk, so the 2D game, the editor,
  the collection and the rulebook never download three.js (~233 KB gzipped).
- **Models and their animations are made in Blender and shipped as `.glb`.**
  The alternative was building bodies in code, which is what phase 1 did.
  Blender wins on everything that matters here: rigging, keyframed clips, and
  the speed of editing a shape by hand instead of a number. It is also no
  slower at runtime. A `.glb` is parsed once and then the GPU just draws, and
  a dozen low-poly rigs animating is nothing. Code keeps what code is good at:
  the moves the game decides (sliding to a tile, the drop, the knock-back) and
  the effects (puffs, shards, bolts). All models are fetched when the stage
  mounts, so the first board takes a moment longer and nothing pops in
  mid-game.
- **Card art is rendered from the same models** (`blender/portraits.py`) into
  `src/ui/art/<cardId>.webp`, the slot every card face already reads. So a
  card's portrait and its figure on the board can't disagree. It is rendered
  offline, not drawn live: a hand or the collection shows dozens of cards at
  once, and a live 3D canvas per card would cost more than the whole board.

**The asset contract** (the header of `blender/models.py` is the working copy):

- One `.glb` per body (`models/caster.glb`) or per card (`models/felix.glb`,
  which wins). Drop it into `src/ui/stage/models/` and it is used, with no code
  change, the same drop-in convention as the card art.
- Blender: Z up, the model faces -Y, feet on the origin. A person is about
  1.6 tall, and the model fits in a circle of radius ~0.5. **The game decides
  how big a unit stands on the board** (`BODY_SCALE` × the look's `scale`), so
  unit size stays a game parameter, not a property of the file.
- One armature and one action per clip, named exactly `idle` (loops), `walk`,
  `land`, `hit`, `attack`, `cast`, `die` (ends lying still). A missing clip is
  skipped. A missing model falls back to the primitive body.
- Materials named by role are repainted per card by the game: `cloth`,
  `trim`, `skin`, `hair`, `metal`, `glow` (emissive), `legs`. Any other name
  keeps its own colour. That is how ten bodies dress 89 cards; a per-card
  model can use its own colours by naming its materials anything else.
- Flat shading, low poly: a few hundred to ~1500 triangles.

The files in `src/ui/stage/`:

| File | Job |
|---|---|
| `Surface.tsx` | 2D or 3D, lazy, falls back to 2D |
| `Stage.tsx` | Canvas + the DOM tile layer and HUD; same props as `Board` |
| `layout.ts` | Slot → world position, camera fit, projection. Pure, tested |
| `looks.ts` | Card data → body, colours, size; `LOOKS` for per-card overrides. Pure, tested |
| `paint.ts` | A look → the colour of each material role |
| `assets.ts` | Which `.glb` a unit stands in |
| `Figure.tsx` | Loads, dresses and animates a model; the primitive body until it loads |
| `models.tsx` | The primitive bodies and scenery (the fallback, and the teaser's vocabulary) |
| `ground.ts` | Battlefield palettes and the seeded prop scatter. Pure, tested |
| `fx.tsx` | Puffs, shards, bolts |
| `looksdump.ts` | `npm run looks`: every unit's look as JSON for the Blender scripts |
| `models/*.glb` | The models, from `blender/models.py` or by hand |

## 5. Camera and layout

A fixed three-quarter view from the viewer's side, the viewer's half near,
mirrored for `p2`, the same rule `Board` follows. No orbit. A free camera is
where legibility dies and the DOM tile layer stops being cheap. Allowed motion:
a slow sweep when a battlefield turns over (`battlefield` beat), and a small
push-in on a `cast`. Both run inside the beat window.

The grid is the real one: two sides × two ranks (F, B) × three columns, twelve
tiles, the arcvonal between the front ranks. **The grid and unit sizes are
open**: the designers want to try other unit sizes and battlefield shapes, so
nothing may assume 3 × 2 outside `layout.ts` (`slotWorld`, `COLUMNS`, `RANKS`,
`TILE`, `PITCH`, `LINE`) and `fitCamera` fits whatever that module says the
board spans. Unit size is `BODY_SCALE` and the look's `scale`, never a
property of a model file. Szakadék (`isBlocked`) tiles are a
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

*Built.* What it is and what it found:

- `layout.ts` is the pure core: slot → world, `fitCamera` (bisects the
  distance, then slides the view with `setViewOffset` so the board sits
  between the hands without being seen from a different angle), and
  `projectTile`. `layout.test.ts` pins the viewer-near rule, column order, the
  fit, and that no two tiles' hit areas share a point.
- The camera is fitted to `.stage-probe`, an empty box sized like the 2D board
  and laid out in the arena's own flow. So the 3D board lands exactly where
  the 2D one would, clear of both hands, with the loupe's column free, and it
  inherits the phone padding for nothing.
- The tile layer is twelve `<button data-slot>`s clipped (`clip-path`) to
  each tile's projected top face. `beginCardDrag`, `flyTo` and the loupe
  worked unchanged. Checked in the browser: drag-to-play, clicking an open
  tile, the loupe on hover, a hidden play, three battles against the bot
  through scoring and leszerelés, and an online room played from both seats.
  The guest draws the host's face-down unit as a blank block without falling
  back to 2D.
- Pieces are keyed by `uid`, so a march slides instead of popping. Flourishes
  read the same `stirring` / `fallen` / `marks` the 2D board does.
  `frameloop="demand"` means an idle board draws nothing.
- drei was not needed yet; the stack is `three` + `@react-three/fiber` v8.
- Left for phase 1: the phone has no way to reach the toggle (the tools rail
  is not on the phone strip), so it follows whatever the desktop chose. Trap
  names and status icons have no hover titles on the 3D board yet, because the
  HUD is `pointer-events: none`.

**1 — Parity with placeholders.** Primitive archetype stand-ins (capsule-and-cone
people, box beasts), the HUD reused from `Board`, every beat in §7 with
procedural motion, fallen ghosts, cast rings, traps, szakadék, veiled units,
battlefield colour per location, the toggle, the WebGL and reduced-motion
fallbacks, the phone tier. *Exit:* everything the 2D board tells you, the 3D one
tells you too.

*Built.* What it is and what it found:

- **Looks come from card data, not card names** (`looks.ts`). `race` picks a
  creature body (Állat → beast, Bestia → brute, Sárkány → dragon, Élettelen →
  construct), then Keleti origin → eastern, then `order`, the Rend (Harcos →
  soldier, Mágus/Druida/Garabonciás… → caster, Orgyilkos/Csempész/Kalóz →
  rogue, Polgár → commoner). Order picks the cloth, origin picks the trim, so
  every Felindori unit wears the same gold. `LOOKS` is the per-card override,
  empty until the card art brief arrives. The data was already good enough:
  every one of the 89 units resolves, and `looks.test.ts` pins it.
- **Bodies are the teaser's primitives** (`models.tsx`): flat-shaded cones,
  icospheres and boxes in person units, scaled onto the tile. Geometry and
  materials are cached and shared. A face-down unit wears one cloak for
  everyone, with no size or colour of its own, and a hidden unit that dies
  bursts in the cloak's colours.
- **Grounds come from the 2D board's own battlefield descriptions**
  (`ground.ts`): all 15 have a faceted ground palette, sky, fog distance, light
  and a seeded prop scatter (pine, round and dead trees, rocks, crates,
  columns). Ködrét closes the fog right in, Kesergő and Umbra go dark.
- **The szakadék** is dark water with the broken slab tipped into it, plus a
  DOM label.
- **Every beat has motion and an effect** (`fx.tsx`):
  - land: drop, squash, dust
  - veil: rises out of dark smoke
  - reveal: a pop and a burst in the unit's trim colour
  - march: slides and hops
  - strike: flinch, sparks, chips
  - fall: thrown back, a flash, shards in the unit's colours, smoke, and the name fading as the pyre
  - cast: a bolt arcing from caster to target in the mark's colour
- **HUD parity:** spellpower pools as the tile's pips, coordinates, trap
  labels and titles (the spell name only for its owner), pyre names, and
  status glyphs you can point at.
- **The phone:** the chronicle panel carries a 3D switch, since the tools rail
  is not on the phone strip. The phone tier draws no shadows, a lower pixel
  ratio and half the scenery.
- Checked in the browser: a full match against the bot to game over across
  four battlefields (Máguskör, A Pék hídja, Akáczos, Faloda), the szakadék, the
  chronicle toggle both ways, no runtime errors. The cast bolt ran without
  errors but was never caught on screen in a screenshot.
- Still open: the battlefield change has no camera move yet. Bolts are tinted
  by foe/friend, not by school (school tints are phase 3). The 3D board is
  still off by default.

**2 — The model pipeline.** Blender to `.glb` to the board, and the card art
rendered from the same models. *Exit:* every unit on the board is a model,
and every unit card has art.

*Built so far:*

- `blender/models.py` writes the ten starter bodies: the phase 1 primitives,
  rigged, with all seven clips, and materials named by role. Its pose sheets
  (`-- --stills`) were checked by eye for every body. Two rotation
  conventions carry every clip: an upright bone leans forward on +X, and a
  hanging limb swings forward on -X. A beast's cast is a howl; a caster's
  levels the staff, because raising the arm overhead turns a hand-held staff
  crystal-down.
- `Figure.tsx` loads every model up front, clones and repaints one per unit,
  and plays clips off the theatre's beats (land, veil and reveal → `land`,
  march → `walk`, strike → `hit`, the caster of the spell on screen → `cast`,
  a death → `die` before the shards). `idle` loops on desktop only: a phone
  and reduced motion come to rest. The primitive body stands in while a model
  loads.
- `blender/portraits.py` renders each unit's card art from its model, in its
  card's colours from `npm run looks`, posed for its class, on a slab under a
  warm sky. It never overwrites art it did not make without `--force`.
- Measured: on a quiet board the idle loops keep the canvas drawing, at about
  240 draw calls a frame. That's fine on a desktop. Merging the static scenery
  into one mesh is the obvious saving when it matters.
- Still open: the starter bodies are the primitives: the real models are
  yours to make in Blender, one file at a time, and each replaces its starter
  without a code change. Per-card looks wait for the card art brief.

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

- How big units stand, and what shape a battlefield is: both are being
  experimented with, so both stay parameters (§5).

Settled: **models are made in Blender** and exported as `.glb`. The teaser in
`trailer/build.py` (repo root) is the first sketch of the look: every piece
there is a scripted primitive, so its units, portal and tiles are a reference
for proportions and palette, not assets to ship.

## 15. The other track: the whole UI in the same style

The low-poly look is not only the board. The main menu, the collection, the
in-game rails and the cards themselves (borders, numbers, symbols) are all to
be remade in the same cozy, lo-fi, low-poly style, with card art from the 3D
models (§4). That is its own track, not a phase of this one: it touches every
stylesheet and `CardFace`, and none of the engine or the stage.

What the stage work already gives it:

- **The art**: `blender/portraits.py` fills `src/ui/art/` for every unit.
  Spells, battlefields and attachments need their own renders once spells
  have models or animations to show.
- **The palette**: the teaser and the stage share one warm, flat vocabulary
  (`ground.ts`, `looks.ts`, `trailer/build.py`). The UI's tokens in
  `theme.css` should be drawn from it rather than invented beside it.
- **Where it plugs in**: every screen's stylesheet sits next to its component
  and `theme.css` holds the tokens (see the CLAUDE.md map). A restyle is those
  files, `src/ui/card/CardFace.tsx` and `card.css`, with the phone rules at the
  foot of each.

**Started (2026-09-30), in the dusk, lamp-lit mood**:

- `theme.css` carries the dusk tokens under the old token names, so every
  screen moved at once. The low-poly look is three things: `--edge`
  chamfers, `--facet-split` (a face cut into light and shadow) and `--facets`
  (a seamless triangulated tile). Nunito for text, Fredoka for display and
  numbers (`fonts.css`, both with latin-ext for ő and ű).
- The menu stands on `menu-valley.webp`, the teaser's valley re-lit at dusk
  by `blender/backdrop.py`.
- Cards (`card.css`): a faceted frame by kind (`kind-*`, which `CardFace` now
  sets itself), cream plates, and gem-cut cost, power, range and pips. Backs
  match the fronts.
- Rails, dock, rulebook, editor, collection and the 2D board tiles are all in
  dusk. About 100 oak-era colour literals in `game.css` were remapped.
- Battlefield art: `blender/battlefields.py` renders each battlefield's
  ground, from the same data as the 3D board.
- Still to come: spell art (once spells have something to render), a pass over
  the smaller in-game panels (the almanac, the aftermath, the hide toll) at
  full size, and per-battlefield room tints for the 2D board.
