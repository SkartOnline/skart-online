# Unit and spell model & animation concepts

Model draft · 16 October 2026 · animation approach revised 17 October 2026.

The current animation plan is in two editable spreadsheets:

- [Unit models and shared rigs](../../outputs/01a14481-9568-78f3-bcf3-992c0821b972/Skart-unit-models.xlsx)
- [Spell visuals and passive effects](../../outputs/01a14481-9568-78f3-bcf3-992c0821b972/Skart-spell-effects.xlsx)

They supersede the per-card caster choreography in the original Markdown
entries. Those entries remain useful as model and spell-form sketches.

The roster in this draft is the current checked-in card data: **89 units and
102 spells**, including the summoned Nyúl. Each card has its own entry, in data
file order, with its Hungarian name and stable ID so it is easy to find and
revise. Appearance, costume, gender where unspecified, and invented props are
proposals rather than established lore. Abilities are taken from the current
data; this draft proposes their presentation.

- [Unit concepts](unit-model-animation-concepts.md) — body, clothing, props,
  stance, locomotion, and distinctive gestures.
- [Spell concepts](spell-model-animation-concepts.md) — physical prop or effect
  geometry, cast sequence, and any lasting visible remnant.

## Shared visual direction

Follow the [art bible](art-bible.md): cozy painted tabletop miniatures, flat
shading, material colours, large readable shapes, and worn or mended belongings.
Use muted cloth, timber, stone and iron, with small bright magical accents.
No painted textures or outlines. Violence is a stumble, a flash, a dropped
weapon or a magical dispersal; creatures stay suitable for the same audience
as the harbour town.

Make each card recognisable through silhouette and one identifying feature
before adding small detail. Shared skeletons and component kits are encouraged;
a shared rig should still allow a rabbit, a wolf and a deer to move differently.
Humanoid bodies aim for the existing 300–1500 triangle budget. People use the
existing scale and export conventions; large creatures and equipment must
still leave neighbouring figures and the HUD visible.

Felindori gold trim, Keleti teal and Törp copper can tie related figures
together. Rend guides dress and tools; species guides anatomy. These are
starting points for your revisions, not a requirement to keep the current
generic bodies or automatic colours.

Spell forms use the existing school palette: blue Mágus, violet Feketemágus,
rust Harcos, olive Zsivány, green Druida and ochre Bestia. Fire, frost and
portals keep their elemental orange, ice blue and violet. Physical techniques
use body motion and real props, with restrained graphic impact shapes.

## Shared animation language

Each shared base rig has five action clips: **Cast 1** points toward an
offensive target, **Cast 2** addresses a defensive target or folds inward for
a self-buff, **Cast 3** is a targetless gesture, **Attack** serves every
Támadás spell, and **Damage taken** is a single shared recoil. Pointing and
release use the same motion regardless of the spell's identity. Spell meshes,
projectiles and impact effects carry the individual card's visual identity.

All five slots exist on each base rig, including rigs used by units with no
current casting school. Schools still determine legal actions. Nehézvért,
Kopja and Pajzs can use the same defensive gesture, followed by different
equipment effects. Kardcsapás and Lefegyverzés use the same Attack clip,
followed by a slash or card-removal effect. Alku uses Cast 3 plus contract,
discard and gyűrű effects. It needs no palm-opening or contract-handling clip.

The workbook proposes eight rig families and links every unit's animation
columns to that library. Changing a rig's description updates all its units.
Ordinary rest, entry, movement and departure continue to use shared baseline
presentation; this round adds no per-card casting or ability choreography.

Belépő can reuse a suitable shared action. Mustra, Diadal, Vigasz, card choices,
draws, discards and passive triggers use the existing movement/removal
presentation, detached visual effects and UI. No new rig clip is required to
flip a coin, inspect a book, salute, dig, grab a victim or handle a trap.
Damage taken plays for actual damage, while power changes use their separate
markers. Gyűrű feedback appears only when a gyűrű actually changes.

The spell workbook's Passive effects tab defines subtle persistent glows,
anchored shapes and small status markers, with brief attach, block and removal
pulses. These replace the tabletop's visible attached-card reminder. Active
conditions and consumed wards must update their markers. Passive effects
require no model rigging and settle to a static display between events.

For spells, **Form** means what needs modelling: sometimes equipment, sometimes
temporary meshes such as a flame, vine or portal. A spell does not need its
own standing character. **Animation** describes anticipation, delivery and
resolution within the existing theatre beats. These are concepts rather than
finished timings; exact motion will be fitted when you choose a card to build.
Prompts can pause a sequence before the choice resolves.

Persistent equipment and status shapes are removable overlays on the original
figure. Keep them small and compatible with animal bodies. A crown, collar,
back ornament or tile-edge prop can replace a hand-held item where needed.
Damage marks, gyűrű counts and numerical effects remain readable through the
existing HUD. Overlapping effects should simplify visually rather than bury
the figure; a unit's base identity must survive equipment changes.

Hidden units keep the same generic veiled body and motion until revealed.
Public trap markers never show the hidden spell; peeks and hand choices use
the existing viewer-specific reveal UI. Animations reflect engine-resolved
results, including wards and failed effects, and finish at the true position.
On phones use fewer temporary pieces; under reduced motion use a short static
pose or mark. No concept requires a camera move or continuous particles.

Card portraits should come from the approved model or a readable spell pose
in the same material style, using the art bible's 4:3 framing. No assets are
being built in this round. You can edit entries directly, then nominate cards
by name or ID for the first implementation pass.

## Open identities and unfinished cards

Calcas, Dérföldi Deoren and Charon have unfinished card text, so their entries
offer a tentative appearance and basic movement. Gouraldir's Három Ereklye
mechanic has no corresponding relic cards yet; his concept leaves their forms
and victory animation open. Burastya's timber body, Bárkakedvenc's seal-like
anatomy and Dionzosz's wolf-shaped hood are especially tentative interpretations
of names and keywords. These are useful places to start your revisions.

The spreadsheets are design specifications. Their notes identify current
Jéghegy and Enormorf rule-to-code differences that need resolving during
implementation. No runtime animation or engine change is part of this draft.
