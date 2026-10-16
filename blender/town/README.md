# Waterfront component kit

Open `kit.blend` for the separate components. Each named collection is a Blender
asset, and `parts/` contains one GLB per component. Walls, reinforced doors,
barred windows, roofs, chimneys, oil lamps, stall frames, canvas awnings,
trade signs, bottles, daggers, relics, crates, barrels, sacks, rope coils,
anchors, docks, hulls, sails, flags and the Patkány are separate assets.
The second art pass adds three irregular roof families, lean-to shelters,
handcarts, drying fish, drains, notices and fishing nets. Buildings combine
these into low shacks, patched homes, shops and sprawling inns with different
footprints. The market trades have their own fixtures and merchandise.
The third pass adds what fills the spaces between houses: fences, woodpiles,
rubble, weeds, three kinds of tree, and three landmarks (a bell tower, a
quay crane and a lighthouse). The art direction is `SkartCF/docs/art-bible.md`.

The three assembled Blender scenes are `sikator.blend`, `feketepiac.blend` and
`kikoto.blend`. In the Outliner, expand an assembly to change an individual
component. Repeated objects share mesh data, so editing a door's mesh updates
the other doors. The library collections are also available as Blender assets.
Each scene's **Playable spaces — preview only** collection marks the board;
it is excluded from runtime exports because the game renders its own tiles.
It is also hidden in beauty renders; enable the collection's render visibility
to inspect the playable footprint. The game still draws its real tile markers.

`flag` supplies one reusable cloth mesh and pole; `pirate_emblem` is a separate
overlay. Recolor the `flag_cloth` material (or use an object material override)
and reuse the flag on other units or battlefields. The merchant ship demonstrates
the same cloth in linen; the pirate ship adds the skull and crossbones overlay.

The three scenes are one town at three times of day: Kikötő in late
afternoon, Feketepiac at dusk, Sikátor at night (`LIGHT` in `town.py`, and
`ground.ts` for the board). Sikátor has four playable spaces, E2/H2 for each
player, between low houses, with a timber gate at the far end.
The miniature Kikötő on the left and Feketepiac on the right use the same kit.
Feketepiac and Kikötő retain twelve spaces. The market has four trade signs:
weapons, apothecary, liquor and relics. The harbor has a cobbled plaza, two
moored ships, cargo and a sailor outfitter. Both town scenes use warm oil lamps;
the harbor has stronger daylight.

The surrounding district continues in every landward direction: connected
lanes, fenced back yards, washing lines and cargo yards lead into a simpler
distant roofline. That roofline is irregular, with taller tenements and
groves, and it never sits on a street (`LANES`, `clear()`). Beyond it, wooded
hills ring the town and sink into the sea on the harbour side. A bell tower
rises above the roofs behind each board, and smoke curls from four chimneys
on the far side. Terrain and water extend to 60 world units, beyond the game's fog,
so turning or pulling back the camera does not reveal the old rectangular
island edge. The harbor quay continues along the coast with mooring bollards
and an outer breakwater. Sikátor's miniature harbor and market connect to
the alley through side streets. The playable clearing remains unobstructed.
Near buildings use the full component assemblies; distant buildings reuse
the roof components over simple shells to keep the scenery economical.

Small copies of the Patkány follow short looping skitter paths outside the
playable area. The unit model uses the same geometry. This checkout previously
only had the generic beast body for that card, so this kit supplies its first
dedicated rat model. The unit export is static; its game movement still follows
the stage's normal movement beats. Ambient rat translation clips are in the
battlefield exports. Ambient animation pauses on phones and for reduced motion.

## Rebuild

From the repository root, with Blender on the path:

```powershell
blender --background --factory-startup --python blender/town.py -- --render --cards
```

This regenerates the kit, component GLBs, editable scenes, runtime battlefield
GLBs, review PNGs and the three card arts (`SkartCF/src/ui/art/<id>.webp`).
Omit `--render` and `--cards` for export only. To change only a card's camera
or light, edit `CARD` / `LIGHT` and run `-- --cards-only [sikator ...]`, which
re-renders from the saved scenes in a few minutes. `CARD_SAMPLES=16` in the
environment makes a quick draft. Copy any hand-edited source
before rebuilding: this is a deterministic generator, not an incremental editor.
After editing the assembled Blender scenes by hand, use
`blender/town.py -- --export-existing` to export those files without regenerating
or overwriting the sources.

`blender/town_review.py` checks exported vertex positions against the source
scenes and renders the component sheet. Add `-- --render-scenes` to refresh
scene previews. The Patkány
portrait uses `blender/portraits.py -- --cpu-render --force patkany`; the CPU
option is useful when headless EEVEE cannot acquire a graphics context.
Use `-- --verify-only` for geometry and animation-target checks without rendering.
Battlefield card art is an 800 × 600 WebP rendered from the same assembled
scene through a perspective card camera, with distance fading into the sky
colour (a mist pass, mixed in the compositor). It is not a separate
illustration.

Dimensions use the stage's world scale: tile width 1, pitch 1.12; rows at
±0.86 and ±1.98. Blender uses Z up and -Y toward the home viewer. Static meshes
are batched by material only in the GLB exports; the Blender sources retain
their individual parts. Battlefield GLBs carry no normals: three.js flat-shades
a mesh without them, and every shared corner stays one vertex, so a scene is
about a third of the size it was with normals. The game uses at most four nearby point lights on
desktop and two on phone, while every lamp keeps its emissive glass.
