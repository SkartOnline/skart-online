# The other realms

`blender/realms.py` builds three battlefields that are not the town: Umbra,
Oppidium and Kesergő. It imports `town.py` for the town's kit (barrels, crates,
woodpiles, weeds), its export and its card camera, and adds its own components.
`kit.blend` holds those, and `parts/` holds one GLB per component. The art
direction is `SkartCF/docs/art-bible.md`.

All three are the ordinary board, three columns by two rows a player. The
**Playable spaces — preview only** collection marks it in each scene and is
never exported.

**Umbra** is a crossroads hall in the prison of the dead. Corridors run out of
it in all four directions with cells on both sides: zombies reaching through
the bars, ghosts held by poison-green chains, demons, and dead kings on their
hoards (one with a spectral horse, one half lizard). The White Shepherd stands
on his slab in the north-west corner with his scythe and pendulum, beside the
gate in the north wall. The jailer's keys hang on the east wall. The hall has no
ceiling and is lit only by blue-fire torches and a ring of green runes round the
board. The rock between corridors is cut by `rock()`, which compresses the open
rectangles' coordinates and merges the rest into slabs.

**Oppidium** is a forest where everything is solid gold: the ground, the trees,
the deer, foxes, boars and birds, and the people seated cross-legged on their
crags along the path. A few of them have turned their heads. There is an
abandoned mine at the head of the clearing, with rails, carts, ore and Kien
spilled from the mint. The ditch the guide would not cross runs down the west
side, and the niche the key was taken from is behind it. Nothing lights it but
torches.

**Kesergő** is an Undan camp in a dense forest in daylight: felt yurts painted
with red zigzags, campfires, drying racks, drums and totems. On the east side
is a cave in a cliff, with a fox skull on a totem before it and three pyrite
chunks laid in a triangle on the ground.

Nothing moves. Ambient clips were cut from every battlefield for performance
(art bible §6).

## Rebuild

From the repository root:

```powershell
blender -b --factory-startup -P blender/realms.py -- --render --cards
```

Names after `--` build only those realms (`-- --cards umbra`). `--cards-only`
re-renders card art from the saved scenes, and `--export-existing` exports
hand-edited scenes without regenerating them, as in `town.py`.
`CARD_SAMPLES=16` makes a quick draft. Each realm is seeded on its own (`SEED`),
so rebuilding one leaves the others alone.
