# Art bible

How anything drawn for Skart should look, so that a unit made in October and a
battlefield made in March sit in the same world. It covers the 3D board, the
Blender sources and the card art rendered from them. The UI chrome (menu,
rails, card frames) has its own planned restyle and is out of scope here,
except where card art meets it.

If a rule here and a script disagree, fix one of them. Don't leave both.

## 1. The look in one paragraph

Cozy lo-fi low-poly, like a painted tabletop miniature. Everything is built from
flat-shaded primitives with **material colours only** (no textures, no UV
painting, no outlines). Detail is carried by **silhouette and by repeated small
parts** (planks, shingles, cobbles, nails), not by polygon density. Surfaces are
**worn and mended** rather than clean: patched plaster, mismatched boards,
crooked chimneys. Wear is shown with a different-coloured part, never with grime
textures. Light does the mood: one key light, a dim sky fill, and warm
practical lamps. It is meant for 12- to 16-year-olds, so the town can be poor,
shady and criminal (smugglers, pirates, fences), but there are no gore, corpses,
gallows or lurid contraband. The rats are the most menacing thing there.

## 2. Geometry

- **Scale is the stage's.** One tile is 1 × 1 world unit, the tile pitch is 1.12,
  the ranks sit at ±0.86 and ±1.98, and the two front rows are 0.72 apart
  (`src/ui/stage/layout.ts`). A person is about 1.6 tall in Blender. The game
  scales units onto a tile, so a unit's board size is a game setting.
  Scenery is modelled at board scale: a door is ~0.6 tall, a cottage wall
  ~0.85, a market stall ~1.1.
- **Blender: Z up, the model faces -Y** (towards the home player), origin on the
  ground at the footprint's centre. glTF export converts to three.js's Y up.
- **Flat shading everywhere.** Never use smooth groups or auto-smooth. Battlefield
  exports drop normals entirely; the GLTF loader then flat-shades and shares
  vertices, which roughly halves file size.
- **Bevels are modelled, not shaded.** A chamfered cobble is an octagon; a sagging
  roof is a moved vertex. Keep faces large enough to read at board distance
  (≥ 0.02 world units for anything that should catch light).
- **Irregularity is deliberate.** Nothing in the town is on a perfect grid or
  perfectly level. Rotate placements ±2–7°, vary scale ±10–20%, and let roofs
  sag, ridges tilt and walls lean. Use seeded `random`, so a rebuild is
  deterministic.
- **The playable footprint is sacred.** Nothing above the 0.06 tile top may
  stand on a playable tile, and nothing taller than ~0.4 may stand within half
  a tile of one where it would hide a unit from the home camera. Ground surfaces
  stay below 0.06.

### Triangle budgets

| Thing | Triangles |
|---|---|
| Unit body (`models.py`) | 300–1500 |
| Kit component (`town.py`, one door or one barrel) | 20–400 |
| A whole battlefield GLB | ≤ 145k triangles, ≤ 120k vertices, ≤ 64 materials (= draw calls), ≤ 2.5 MB |
| Animated nodes per battlefield (rats, smoke) | ≤ 16 roots |

Far scenery (more than ~10 units from the board) uses the cheap variants: the
`roofline_house` shell under a real kit roof, merged hill masses and cone trees.
The fog hides the rest. Don't spend triangles where the fog has already
started.

## 3. Palette

All colours are sRGB hex in the scripts and converted to linear once (`srgb()` /
`mat()`). Keep to these families; a new colour should sit next to one of them.

| Family | Swatches | Used for |
|---|---|---|
| Timber | `#40352e` dark, `#68503d`, `#8d7353` light | frames, planks, crates, hulls |
| Plaster | `#81766a`, `#afa28a` chalk, `#706c63` soot, `#a08665` ochre, `#9b8c79` patch | walls; one tone per house |
| Stone | `#595652` dark, `#69655f`, `#827b6f` light, `#4d4943` mortar | cobbles, quay, chimneys |
| Roofs | `#555f61` slate, `#7b8280` faded slate, `#594b41` umber shingle, `#83634e` rust | one family per roof, ~1 in 4 tiles off-tone |
| Earth | `#766e60` earth, `#5b554b` mud, `#918470` dust, `#525e43` moss | ground, verges, weeds |
| Cloth | `#bcab89` linen, `#657063` green, `#986b51` russet, `#797c77` grey, `#756775` plum | awnings, sails, washing |
| Metal | `#353a38` iron, `#a7aba5` steel, `#ad8948` brass | straps, bars, blades, fittings |
| Water | `#427c86`, `#64989b` light, `#386974` dark | the harbour |
| Light | `#ffc06c` lamp glass (emissive 3) | every practical light source |

Rules of thumb:

- **Saturation stays low** except in three places: lamp glass, water, and one
  accent per battlefield (Feketepiac: plum awning; Kikötő: teal sea and the
  black pirate flag; Sikátor: the amber of its lamps against blue night).
- **Values are mid.** Nothing in the scenery is darker than `#2e2a26` or lighter
  than `#dfd2b4`. Pure black and pure white belong to the UI and to emissives.
- Unit role colours (`cloth`, `trim`, `skin`, `hair`, `metal`, `glow`, `legs`)
  are repainted per card by `looks.ts`. Scenery never uses those names.

## 4. Light

The three town battlefields are **one poor harbour town at three times of
day**. Walk from the quay through the market into the alley, and the sun goes
down on the way:

| Battlefield | Time | Key light | Sky / fog | Practicals |
|---|---|---|---|---|
| Kikötő | late afternoon | warm gold sun `#fff0cf`, strong | pale sea blue `#a5c5ce` | lamps lit but barely visible |
| Feketepiac | dusk | low amber sun `#f4d2a0`, medium | smoky taupe `#84796b` | lamps under every awning, clearly glowing |
| Sikátor | night | cold moonlight `#a9b8d8`, weak | deep slate blue | lamps carry the scene, pools of amber on wet stone |

- **The key light always comes from the upper left of the home view**
  (`[-3.5, 7, 4.5]` in the stage), so shadows fall away to the right on every
  battlefield and card.
- **Practicals are `lamp_oil` and nothing else.** A point light lives only in
  that kit component, so the runtime's lamp budget (4 desktop, 2 phone, nearest
  to the board, chosen once) stays the one rule about point lights. Lamp glass is
  emissive, so distant lamps glow without lighting anything.
- The board stays readable at every time of day. A unit on any tile must
  show its silhouette against the ground. If night costs that, raise the
  hemisphere fill (`ambientIntensity`) before you brighten the moon.

## 5. Card art

Card art is rendered, never painted over, so the card and the board are the same
place.

- **Format:** 4:3 WebP, 800 × 600, quality ~90, in `src/ui/art/<cardId>.webp`.
  It shows at about 140 px wide on a card face, so compose for that size first.
- **Units** (`portraits.py`): the unit's own `.glb` in its looks, three-quarter
  view, one soft key from the upper left, a plain sky gradient. Nothing else.
- **Battlefields:** a **perspective** camera (35–50 mm equivalent), slightly
  above eye height, looking *into* the place. Don't use an orthographic map
  view: it reads as a floor plan and turns to noise at card size.
  - One focal subject in the middle third (Sikátor: the lamp-lit mouth of the
    alley; Feketepiac: the stalls under their awnings; Kikötő: the moored ships
    at the quay).
  - The brightest value sits on the focal subject, and the frame edges fall
    off into shadow or mist.
  - The background dissolves into atmosphere (world colour plus mist), never a
    hard horizon edge or the end of the ground plane.
  - Same light as the board's time of day (§4), pushed a little further for
    drama. A card is allowed more contrast than the board.
  - No tile guides on town cards: the scenery is the subject.
- Older battlefields (`battlefields.py`) show two slabs on their faceted
  ground. They predate this bible and can stay until they are remade.

## 6. Pipeline and naming

| Script | Makes | Contract |
|---|---|---|
| `blender/models.py` | unit bodies, rigged, with clips | header of the script; `docs/stage-3d.md` §4 |
| `blender/portraits.py` | unit card art | §5 above |
| `blender/town.py` | town kit, three town battlefields, their card art | `blender/town/README.md` |
| `blender/battlefields.py` | card art for the procedural battlefields | §5 above |

- **The scripts are the source.** The `.blend` files are generated for
  inspection and hand-tweaking. A rebuild overwrites them, so a hand edit
  either goes back into the script or is exported with `--export-existing`
  and committed with a note.
- Object names describe the thing (`worn cobble`, `iron strap`), because they
  show up in the Outliner and in the parts sheet. Material names are the
  palette names in §3.
- New scenery is a **kit component** first (one collection in `build_kit()`,
  facing -Y, origin on the ground) and is placed with `instance()`. Repeated
  parts share mesh data in Blender; the battlefield export batches static
  meshes by material.
- Things that move (rats, smoke) keep their own hierarchy and an action named
  `<name>_<verb>`, looping over frames 1–145 at 24 fps. Ambient motion stops on
  phones and under reduced motion (`Battlefield.tsx`).
