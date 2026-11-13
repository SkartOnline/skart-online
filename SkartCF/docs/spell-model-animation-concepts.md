# Spell model and animation concepts

First draft · 16 October 2026 · 102 spells.

The [17 October spreadsheet](../../outputs/01a14481-9568-78f3-bcf3-992c0821b972/Skart-spell-effects.xlsx)
supersedes caster choreography below with three shared cast clips and one
shared Attack clip per base rig. Spell visuals and passive indicators use
separate effects, with no per-spell rigging.

See the [shared brief](model-animation-brief.md) for style, timing and review notes.
Form describes a physical prop or temporary effect mesh; lasting remnants remain still.
Entries follow spells.json order. All designs are proposals for your edits.

### Harapás (`harapas`)

- **Form:** A pair of chunky ivory bite arcs with ochre impact chips; the caster supplies the actual jaw or lunging body gesture.
- **Animation:** Crouch, snap forward and close the arcs once at the target. The victim flinches at the resolved hit, and the arcs break into a few blunt chips without blood.

### Odú (`odu`)

- **Form:** A low earth-and-root arch suggesting a burrow mouth behind the caster, with a cutaway opening that keeps the figure visible.
- **Animation:** The caster tucks back as the arch rises around its tile. It settles into a static shelter; a small leaf-shaped ward mark shows protection only while the caster has no adjacent ally.

### Roham (`roham`)

- **Form:** Two low dust wedges and a forward-leaning charge pose, using ochre and rust accents.
- **Animation:** The caster braces, then runs or bounds along the engine's resolved advance to its stopping tile. Dust follows the route and settles at a firm stop; a blocked charge never turns into an invented attack or collision injury.

### Ugrás (`ugras`)

- **Form:** A compressed takeoff pose, one curved dust ribbon and a small landing puff.
- **Animation:** The caster coils, hops to the chosen szomszédos tile and absorbs the landing through its legs or body. Keep the arc compact enough to read under the board camera without covering other figures.

### Gyógyfüvek (`gyogyfuvek`)

- **Form:** A tied bundle of broad sage leaves, with three pale green leaf pieces for the healing flourish.
- **Animation:** The bundle opens over the ally and the leaves fold around it. One resolved damage-card mark lifts away and dissolves; the unit straightens slightly, without suggesting that every wound or other placed spell has been removed.

### Indák (`indak`)

- **Form:** Thick angular green vines with a few large leaves, rooted at the tile edges.
- **Animation:** The vines grow inward and coil around the target's lower body once. They settle into a static open cage that leaves the face and power visible, remaining until the movement restriction is removed.

### Növekedés (`novekedes`)

- **Form:** A green shoot opening into a small brass-and-leaf gyűrű emblem.
- **Animation:** A leaf spirals from the caster to the allied Állat, which stretches into a proud pose as the emblem closes. One gyűrű is acknowledged in the HUD; the animal returns to its normal scale and footprint.

### Oltalom (`oltalom`)

- **Form:** Three broad wooden leaf plates forming a sparse canopy, with a warm pale green centre.
- **Animation:** The plates unfold around the ally and close into a small static protective ornament. Feketemágia that is actually blocked brushes off as violet chips; a firm root-shaped base motif suggests the alapereje floor without implying damage immunity.

### Sújtás (`sujtas`)

- **Form:** A short fork of pale green natural light, shaped like a stripped branch rather than a fire projectile.
- **Animation:** The caster strikes downward and the fork snaps onto the target. Use the resolved damage for the hit response, with a stronger flash for the qualifying Élettelen or Feketemágus result; a spared target gets no false wound reaction.

### Alku (`alku`)

- **Form:** A folded violet contract, a blunt wax seal and one small gyűrű emblem.
- **Animation:** The caster offers an open palm while the selected spell leaves through the existing discard presentation. Only after the payment resolves does the seal crack and the gyűrű close around the caster's marker; the diminished hand level stays in the UI.

### Megtorlás (`megtorlas`)

- **Form:** A dark violet ribbon connecting the sacrificed ally's tile to its chosen neighbouring enemy, with a faceted bright tip.
- **Animation:** Hold the caster's gathering gesture until both choices resolve. The ally disperses into the ribbon, which snaps to the enemy and produces the resolved damage response; no body parts or blood travel with it.

### Transzfúzió (`transzfuzio`)

- **Form:** Two small violet brackets enclosing a neutral card-shaped plate; any existing attachment prop supplies its recognisable silhouette.
- **Animation:** Lift the selected placed card from the caster and carry it along a short arc to the neighbouring recipient. The corresponding overlay disappears at its source and settles at its destination after resolution; the effect is a transfer of one card, with no blood imagery.

### Ősi omen (`osi_omen`)

- **Form:** A small hinged violet divination disc with an abstract doorway motif, not an image of the coming battlefield.
- **Animation:** The caster opens the disc, peers into its light and closes it. The next-csatatér information appears only in the entitled player's reveal UI; the public flourish looks the same whatever was seen.

### Falanx (`falanx`)

- **Form:** A compact guard pose and a bronze chevron at the caster's tile edge, without adding an actual shield item.
- **Animation:** Plant the feet and turn the shoulder toward the arcvonal. The chevron rests brightly in the first row and dulls outside it, following the conditional power bonus rather than granting a gyűrű or restricting movement.

### Kardcsapás (`kardcsapas`)

- **Form:** A broad steel slash wedge with a short rust-coloured trail; use the caster's blade or an equivalent physical strike.
- **Animation:** Draw back, deliver one clear diagonal cut and recover. The wedge stops at the target's tile and produces a compact hit spark, with no spell bolt and no movement into an occupied slot.

### Lefegyverzés (`lefegyverzes`)

- **Form:** A small steel hook-shaped parry arc and one tumbling neutral card plate.
- **Animation:** The caster sweeps upward and the resolved removed card flips off the enemy. If that card had an equipment overlay, detach that overlay too; innate weapons and permanent parts of the unit model stay with the figure.

### Manőver (`manover`)

- **Form:** A low boot scuff and a deliberate sidestep pose in muted rust.
- **Animation:** Turn the torso toward the chosen szomszédos tile, take two economical steps and return to guard. Keep the whole movement grounded, distinguishing the technique from Ugrás and Teleport.

### Explar (`explar`)

- **Form:** A blunt orange flame tongue with a pale yellow core and two large ember chips.
- **Animation:** The caster scoops a spark forward into a short arcing fire jet. It folds against the target in one warm flash, then goes out; the victim's damage response follows the actual result.

### Fagypáncél (`fagypancel`)

- **Form:** Three thick ice-blue armour plates, fitted as a chest or shoulder shell and adaptable to a beast's back.
- **Animation:** Frost facets assemble inward and settle against the ally. A protected hit chips the outer ice briefly before it returns to its intact static form; the HUD carries the actual damage after reduction.

### Tűzköpeny (`tuzkopeny`)

- **Form:** A short faceted orange mantle, with a warm inner surface and a small pale frost accent at the hem.
- **Animation:** A ribbon of fire folds around the ally and cools into a still glowing mantle. On a blocked Tűzmágia or Fagymágia spell, its matching edge flashes once; unrelated hits use their normal response.

### Becsusszanás (`becsusszanas`)

- **Form:** A low sideways lean and a narrow olive-grey scuff along the diagonal route.
- **Animation:** Drop one shoulder, slip diagonally to the chosen tile and straighten with a quick glance back. The figure remains visible through the move; the technique gives neither hiding nor a teleport effect.

### Elcsenés (`elcsenes`)

- **Form:** One brass gyűrű emblem and a short olive swoop shaped like a hooked hand gesture.
- **Animation:** The caster feints with one hand and flicks the other toward the enemy. A single emblem slips from the enemy marker to the caster's, settling only if the theft resolves; no additional equipment changes hands.

### Tőrhajítás (`hajitotor`)

- **Form:** A broad triangular steel throwing dagger with a wrapped russet grip.
- **Animation:** Flick the dagger along a shallow arc and let it flash once on contact before vanishing. An isolated target receives the stronger resolved hit reaction; the projectile shape stays the same so the difference reads as opportunity rather than a second weapon.

### Hátbaszúrás (`hatbaszuras`)

- **Form:** A short steel dagger silhouette and a tight olive crescent behind the target.
- **Animation:** The caster ducks and makes a compact thrust while the crescent lands at the target's back. Use a stronger reaction for the resolved back-row damage, without physically moving the caster behind the enemy or adding a new movement action.

### Kötél (`kotel`)

- **Form:** A thick tan rope loop, a large readable knot and two low coils.
- **Animation:** Cast the loop, draw it tight around the lower body and let the knot land to one side. The rope remains static while attached; the pose leaves hands and head visible and shows no suspension or choking.

### Összjáték (`osszjatek`)

- **Form:** Two matching olive hand-signal chevrons and small footfall puffs.
- **Animation:** The chosen neighbouring allies acknowledge a signal and pass each other on shallow complementary arcs. They settle in the exchanged tiles together, with no extra attack, concealment or magical portal.

### Marcangolás (`marcangolas`)

- **Form:** Two blunt ivory claw or bite strokes, broader and more ragged than Harapás.
- **Animation:** The caster lunges in a brief two-part rake and pulls back to its own tile. The weaker target takes one resolved damage response as the ivory strokes break away; the force comes from body weight and timing, without gore.

### Szorítás (`szoritas`)

- **Form:** Two ochre crescent shapes suggesting closing paws or jaws, held low around the target.
- **Animation:** The crescents close once and settle into a static restraint bracket. If the target was already unable to move and damage actually resolves, add a single hard compression and hit response; otherwise show the restraint alone.

### Csatacsorda (`csatacsorda`)

- **Form:** A broad green leaf crest splitting into identical small gyűrű emblems.
- **Animation:** Bless the selected Állat first, then send matching leaf flicks to the allied copies that actually receive the effect. Each recipient gives a short proud lift and acknowledges its gyűrű; unrelated animals remain still.

### Ki mint vet (`ki_mint_vet`)

- **Form:** Two large ochre seeds cupped in green leaves, one with a simple figure notch and the other a spark notch.
- **Animation:** The caster sows the seeds into a small closing earth fold beside its tile. The fold settles and vanishes after a brief promise of growth; the future unit and spell hand-level benefits appear in the next csata's UI rather than as immediate cards.

### Természetes forma (`termeszetes_forma`)

- **Form:** A plain wooden hoop and a small symmetrical leaf seal, deliberately simpler than the other enhancements.
- **Animation:** The hoop passes over the unit, briefly revealing its unadorned silhouette before the leaf seal settles. Keep existing placed-card records and gyűrű intact; the visual identifies computed power being held at the unchanged alaperő, without pretending to cleanse those cards or heal damage.

### Tisztítás (`tisztitas`)

- **Form:** A shallow green wash with three broad pale leaf blades, like a small brush sweeping the air.
- **Animation:** Sweep across the ally and lift away the one placed card that the effect removes. Its matching overlay peels off; the wash then fades, leaving a small inert leaf seal for the placed Tisztítás card and no continuing ward.

### Töviskorbács (`toviskorbacs`)

- **Form:** A segmented woody vine with a few oversized blunt thorns and one green leaf at its base.
- **Animation:** The vine uncoils from the caster, snaps against the enemy and recoils into leaves. The target receives the resolved damage response; no loop or roots remain to suggest Indák's movement restriction.

### Halálfélelem (`halalfelelem`)

- **Form:** A small hollow violet mask hovering beside the target's shoulder, with a downward-pointing dark fold.
- **Animation:** The mask turns toward the target and its shadow seems to weigh down the stance. It rests dimly while an allied neighbour is present and deepens when the isolation penalty applies; there is no wound or disappearing gyűrű.

### Lélekszipoly (`lelekszipoly`)

- **Form:** A broad violet ribbon with four small brass sparks at its receiving end.
- **Animation:** The selected ally folds into a clean spectral silhouette, then streams to the caster as it leaves the board. Four gyűrű acknowledgements close in one grouped flourish when granted; the caster returns to rest without a persistent beam.

### Senyvesztés (`senyvesztes`)

- **Form:** A single thin violet fold resembling a wilting leaf, with a muted grey tip.
- **Animation:** The fold drifts onto the target and lowers its shoulders for a moment. Leave a small dull status ornament as the power falls; use no impact spark or wound marker for the reduction itself.

### Acélpenge (`acelpenge`)

- **Form:** A broad short steel blade with a brass rivet and a patched grip; an animal can wear it as a small harness-mounted blade ornament.
- **Animation:** The blade swings into the ally's grasp or mounting point and catches one clean highlight. The unit tests its new weight, then holds a stronger rest pose while the equipment remains attached.

### Egységben az erő (`egysegben_az_ero`)

- **Form:** A rust cloth pennon on the caster and three matching bronze tile-edge chevrons.
- **Animation:** The caster raises the pennon; when the first row has the required three allies, the three chevrons answer together and the figures square their stances. The cloth and marks then rest, with the bonus responding to the formation rather than leaving gyűrű behind.

### Kitörés (`kitores`)

- **Form:** A low rust dust fan followed by a compact steel strike wedge.
- **Animation:** If the optional move is chosen, the caster steps to the resolved szomszédos tile before delivering the strike. If it stays, start from its existing stance; both paths finish with the same enemy hit response and recovery.

### Kopja (`kopja`)

- **Form:** A readable ash-wood spear with a broad steel head, angled upward when at rest to avoid covering adjacent figures.
- **Animation:** The caster sets the butt and lowers the point when an enemy stands directly ahead. A bronze guard mark strengthens with that condition, indicating its power and targeting protection; the spear remains attached when the condition ends.

### Nehézvért (`nehezvert`)

- **Form:** Two large dark iron torso plates, wide shoulder caps and visible brass fasteners, adapted as a carapace for non-humanoids.
- **Animation:** The plates clamp on with one heavy downward settle. The caster spreads its feet into a weighted stationary pose, with a static broad base mark supporting the movement restriction and no repeated labouring animation.

### Pajzs (`pajzs`)

- **Form:** A chamfered wooden shield with a broad steel boss and two mismatched planks; a shoulder or flank mounting suits animals.
- **Animation:** The ally catches or accepts the shield and turns it outward. A protected hit tips it back for an instant and throws a small deflection chip, then it returns to a static guard; the resulting damage remains the engine's decision.

### Vérszomj (`verszomj`)

- **Form:** A rust-red cloth wrist or harness strip and a low amber angular crest, with no blood imagery.
- **Animation:** The caster tightens its grip and leans eagerly toward the enemy half. A brief crest flare acknowledges changes in the bonus from damaged enemies; afterwards the strip stays still and no gyűrű is created.

### Lélektűz (`lelektuz`)

- **Form:** Small orange flame facets gathering around the target's visible placed-spell, damage-card and gyűrű markers, then converging at its chest or body centre.
- **Animation:** The caster closes a hand and the collected sparks ignite together in one contained flare. Scale the reaction to the resolved damage; the existing cards and gyűrű remain, because counting them does not consume them.

### Széllökés (`szellokes`)

- **Form:** Three broad pale blue wind vanes with a few large dust chips near the ground.
- **Animation:** The caster sweeps sideways and a short gust carries the target to its chosen szomszédos tile. The target catches its balance as the vanes flatten and disappear; the move causes no invented damage.

### Vaskarom (`vaskarom`)

- **Form:** Three short iron prongs bending into a chunky wearable gyűrű, with a blue spark at the join.
- **Animation:** The prongs orbit once, close into the ring and settle on a hand or harness. A single gyűrű acknowledgement connects the prop to the HUD; the iron ornament remains while its ring-flagged attachment is present.

### Álomfogó (`alomfogo`)

- **Form:** A small wooden hoop with geometric crossed strands and three broad feather pieces, using blue and linen accents.
- **Animation:** The hoop unfolds beside the ally and settles. When its next-spell protection is consumed, the strands catch the incoming effect, brighten once and break into harmless feathers; the protective ornament then disappears.

### Fedezék (`fedezek`)

- **Form:** A low folding screen of three weathered plank segments, kept within the caster's tile and below its face.
- **Animation:** The caster crouches and swings the screen into position. It stands as a static prop, with its protective mark active in the back row and dim elsewhere; the figure remains visible and does not become a hidden unit.

### Infiltráció (`infiltracio`)

- **Form:** A brief olive cloak sweep and two narrow dust puffs marking departure and arrival.
- **Animation:** The chosen Orgyilkos or Csempész ducks behind its cloak and reappears at the resolved empty tile. Treat the concealed transit as a short stage shortcut with no magical portal, extra hiding status or effect on intervening units.

### Leskelődés (`leskelodes`)

- **Form:** A small patched linen viewing hood or simple wooden spyglass, with an olive lens glint.
- **Animation:** The caster leans out, peers through the prop and quickly tucks it away. Only the authorised reveal UI shows the opponent's varázslatkéz; the public model never displays card faces or changes its gesture with their contents.

### Testcsel (`testcsel`)

- **Form:** A sharp shoulder feint, a heel scuff and two short olive direction wedges.
- **Animation:** The caster fakes one way, then slips around the neighbouring enemy on a small curved path. The enemy turns to recover as both settle in the exchanged tiles; neither receives an extra hit or magical status.

### Túszejtés (`tuszejtes`)

- **Form:** A small linen hood, crooked timber hook and russet cord make a theatrical capture kit. The hood is an empty prop, with no captive miniature or clue to the stolen unit's identity.
- **Animation:** The caster snaps the hood shut and reels the cord back with a quick shoulder pull. The authorised card-back transfer carries the actual deck-to-hand result; the kit disappears after the gesture, and the public stage never previews the stolen unit.

### Vérdíj (`verdij`)

- **Form:** A small ochre notice pinned to a bent iron stake carries three brass coin studs, with a simple raised silhouette instead of a portrait. It sits beside the marked unit without hiding its body.
- **Animation:** The caster points out the target and plants the notice with a firm stamping gesture. The notice remains still while the attachment exists; if the engine awards the bounty, its three studs hop once toward the credited allied killer and settle into the shared gyűrű display.

### Zsebmetszés (`zsebmetszes`)

- **Form:** A patched plum purse and narrow steel snips provide a physical sleight-of-hand motif. Only a generic card back may protrude from the purse, never the outline or colour of the stolen spell.
- **Animation:** The caster conceals the snips behind a shoulder, makes one neat cutting motion and draws the purse close. Existing private hand presentation shows the stolen spell and reduced opposing hand level; the public prop folds away without exposing the card or staging an attack on a board unit.

### Sárkánypikkelyek (`sarkanypikkelyek`)

- **Form:** Broad overlapping scale plates in moss green and dark slate clasp the caster's shoulders and flanks, with a few muted brass tips. Their open arrangement preserves the original miniature's face and silhouette.
- **Animation:** Three ranks of scales rise from the caster's feet, travel up the body and click into place. They then remain completely still as the spell-immunity attachment; a blocked spell may produce one short glancing sparkle when that outcome resolves, without suggesting physical invulnerability.

### Vedlés (`vedles`)

- **Form:** An oversized split shell of faceted ochre skin, built from a few broad loose panels, briefly surrounds the caster. Small pale flakes establish shedding rather than destruction or damage.
- **Animation:** The caster hunches, splits the shell along its back and steps its shoulders free as the panels tumble outward. Removed placed-card props, their dependent visuals and existing damage marks clear together; earned gyűrű remain. The discarded shell dissolves, leaving the cleaned miniature at rest.

### Csordaszellem (`csordaszellem`)

- **Form:** A small braided reed collar with three carved animal-head beads becomes the caster's attachment. A fleeting moss-green antler arch provides a larger readable shape during the cast without adding a permanent spirit animal.
- **Animation:** The caster lifts its head as the antler arch unfolds, sending one low sweep toward the currently affected adjacent allied Állatok. The arch clears and the collar stays still; conditional power feedback follows actual adjacency, with no gyűrű or lasting token granted to the neighbours.

### Metamorfózis (`metamorfozis`)

- **Form:** A loose cocoon of large olive leaves and linen-coloured seed husks closes around the caster. Its broad faceted panels fit the occupied tile and leave room for the selected Állat's silhouette.
- **Animation:** After the private hand choice resolves, the leaves twist shut around the caster, pause for a single compressed beat and peel apart. The chosen eligible Állat appears in the same place as the engine replaces the caster; the leaves scatter and vanish without showing other cards from the hand.

### Napfény (`napfeny`)

- **Form:** Five flat amber sun rays fan from a small ochre disc above the recipient. A compact brass sun tab at the unit's base serves as the still placed-spell marker for the power increase.
- **Animation:** The caster opens its palm and the ray fan tilts down over the chosen ally in a brief patch of warm light. The miniature straightens as its resolved +2 power appears, then the rays close and disappear, leaving the sun tab static and granting no gyűrű.

### Rothadás (`rothadas`)

- **Form:** A squat cracked fungus cup in soot grey and bruised plum clings near the caster's base. Temporary folded leaf shapes in dusty olive make the spreading decay readable without wounds, gore or a permanent fog bank.
- **Animation:** The cup opens once and a low ring of curled leaves skims toward affected adjacent units on either side. The leaves fall away while the fungus remains still; the neighbouring −2 power comes and goes with the resolved aura, never as damage chips or persistent gyűrű changes.

### Morál (`moral`)

- **Form:** A short patched russet pennant on a timber staff, tied with a brass clasp, rests beside the caster. The cloth is made from two rigid creased planes rather than a continuously simulated flag.
- **Animation:** The caster stamps once and punches the pennant upward, prompting a single answering brace from the currently affected adjacent allied Harcosok. The pennant settles into a fixed raised pose as the attachment, while the caster's +1 and conditional neighbouring bonuses remain ordinary power feedback without magical trails or gyűrű.

### Párbaj (`parbaj`)

- **Form:** Two short steel blade arcs and a dropped linen challenge glove form a physical duelling motif. The blades use the contestants' equipment where possible, with a plain training-blade substitute only for the brief contact pose.
- **Animation:** The caster throws down the glove, squares toward the adjacent opponent and meets it in one sharply timed crossing strike. Only the engine-resolved loser falls, with the survivor returning to its tile pose; a result with no death ends in a disengagement and all temporary props clear.

### Áttörés (`attores`)

- **Form:** A broad steel shoulder plate and wedge-shaped dust chips emphasise a body-driven breach. The temporary contact shape is low and blunt, in iron, linen and dusty earth colours.
- **Animation:** The caster drops its shoulder and makes a short forward drive toward the selected target without changing its board position. A resolved front-row hit receives one heavy contact jolt and its damage feedback; when the effect deals nothing, no wound or exaggerated impact appears, and the caster pulls back as the dust clears.

### Óriásölő (`oriasolo`)

- **Form:** A small iron climbing hook and a single pale steel slash describe a precise strike against a powerful adjacent unit. A short russet grip keeps the prop readable against larger miniatures.
- **Animation:** The caster feints low, catches the target's balance with the hook and follows with one rising weapon stroke. The eligible chosen unit topples only when the engine resolves its destruction; the caster recovers on its own tile and the hook-and-slash accent disappears, without a magical execution column.

### Elfeledés (`elfeledes`)

- **Form:** Three blank chalk tablets, each missing a corner, clasp around a small plum knot near the recipient's shoulders. Their visibly empty faces suggest erased knowledge without adding readable writing or textures.
- **Animation:** A narrow ribbon of slate-coloured fragments runs from the caster to the target, where the tablets rotate once and turn their blank faces outward. The tablets then remain still for the ability-suppressing attachment, leaving the unit's body intact and avoiding any suggestion that its power or casting is separately reduced beyond the resolved rules.

### Geománcia (`geomancia`)

- **Form:** A shallow bowl of broken stone tablets surrounds a single brass divining peg. Chalk, slate and ochre faces distinguish it from leafy Druida magic while keeping the recovered spell itself in the existing card interface.
- **Animation:** The caster draws the peg across the stone, lifting one tablet from the bowl as the graveyard search is completed. The selected spell's authorised card movement provides the actual return to hand; the bowl settles and disappears without conjuring a unit or revealing unselected cards in the scene.

### Némítás (`nemitas`)

- **Form:** A tiny split bronze bell is held shut by a plum cloth band near the target's upper body. It reads as a closed sound-making object even on creatures without a human mouth.
- **Animation:** The caster pinches two fingers together and a narrow muted ripple carries the folded band to the bell, closing it with one abrupt stop. The fast-moving ripple clears, leaving the bound bell still while casting is prevented; the target retains its other abilities and receives no damage reaction.

### Szikraszilánk (`szikraszilank`)

- **Form:** One jagged charcoal shard encloses a bright amber core, with two smaller orange facets trailing behind. Its broken mineral shape distinguishes it from a smooth fireball or the straight Lánglándzsa.
- **Animation:** The caster cracks a dark fragment apart in its palm and flicks the glowing centre along a quick shallow arc. It breaks against the chosen unit in a brief fan of sparks as the resolved four-damage hit reacts, then all airborne fragments extinguish and only ordinary damage feedback remains.

### Csapdaállítás (`csapdaallitas`)

- **Form:** A low timber hatch with an iron corner peg marks the selected empty enemy tile. Every hidden spell uses the same neutral closed hatch, with no school colour, component or shape identifying its contents.
- **Animation:** The caster kneels to prepare a generic folded packet, and the hatch presses flat onto the selected tile after the private spell choice resolves. It remains static and publicly visible until triggered; only the owner sees the stored spell's name, and the actual spell visual begins when its engine-resolved trap activation becomes public.

### Fojtás (`fojtas`)

- **Form:** A short loop of dark linen cord with two worn timber handles supplies the physical motif. It stays a small hand prop and avoids realistic choking detail or any treatment of the target as a corpse.
- **Animation:** The caster slips close in a low pose, draws the cord taut in a single silhouette-readable pull and immediately releases it. The eligible weak enemy drops into the shared clean fall only when destruction resolves, and the caster withdraws as the cord clears, with no magical projectile or lingering restraint attachment.

### Füstbomba (`fustbomba`)

- **Form:** A round patched clay smoke pot with an iron cap accompanies three broad slate-grey smoke panels. After the burst, a small spent pot and a sparse fixed smoke arch identify the targeting protection without hiding the miniature.
- **Animation:** The caster tosses the pot on a short arc, and it pops into a brief expanding puff around the recipient. The moving smoke dissipates into the static open arch for the attachment's duration, indicating that spells cannot target the unit while leaving its silhouette and legal non-spell interactions readable.

### Rajtaütés (`rajtautes`)

- **Form:** A low sweep of plum cloak planes and a short steel dagger accent frame a sudden physical attack. The cloak is temporary action geometry, never an extra concealed unit or persistent concealment effect.
- **Animation:** The caster crouches behind the cloak sweep and darts into one quick sideways strike against the selected isolated enemy. The resolved victim falls, then the caster snaps back into its own tile pose as the cloak folds away; surrounding units receive no impact and no new movement is implied.

### Rozzant gránát (`rozzant_granat`)

- **Form:** A lopsided iron grenade is patched with a brass plate and a short crooked linen fuse. Its explosion uses broad ochre smoke wedges and blunt grey fragments rather than shrapnel detail or a realistic fireball.
- **Animation:** The caster struggles with the faulty pin, then thrusts the grenade into the space between itself and the adjacent enemy. One compact burst accompanies the two engine-resolved destructions, and both models make their clean falls before the fragments vanish; other neighbours receive no damage, recoil or implied area effect.

### Falkavezér (`falkavezer`)

- **Form:** A rough timber crest shaped like an angular animal muzzle crowns the caster's base, with moss-green cheeks and brass teeth. Small temporary paw-shaped plaques provide a counting motif without leaving marks on other Állatok.
- **Animation:** The caster raises its head as one short acknowledgement flick travels from each contributing allied Állat toward the crest. Only the engine-awarded gyűrű count settles into the caster's shared ring display, then the plaques and crest clear so the already-earned strength never reads as an ongoing proximity aura.

### Vén tölgy (`ven_tolgy`)

- **Form:** A broad split oak trunk cups the ally's lower body, with a few gnarled roots gripping its own tile. Moss-green leaf clusters and light timber heartwood keep the original miniature visible above the bark.
- **Animation:** An acorn-shaped seed drops from the caster's gesture, sprouts beneath the recipient and unfolds into three thick trunk panels. The ally braces as +3 power resolves, then the roots and bark stay fixed while the attachment prevents movement, without extending roots onto other playable tiles or adding continuous leaf motion.

### Csontvért (`csontvert`)

- **Form:** Clean stylised ivory ribs and broad knuckle-like plates form a temporary armour assembly, with muted plum bindings. The pieces are abstract carved bone, with no skulls, remains or anatomical gore.
- **Animation:** The caster draws a short spiral of bone plates upward from the direction of the public graveyard, and they close into an armoured silhouette for one beat. As the engine's graveyard-scaled reward resolves, up to five earned gyűrű settle into the shared display and the temporary assembly fades, suggesting strength rather than damage reduction.

### Feltámadás (`feltamadas`)

- **Form:** A low arch of chipped slate and chalk candles frames a cool blue seed of light. It is a ceremonial doorway, with no tomb contents or remains on display.
- **Animation:** After the eligible graveyard unit is chosen, the arch rises at its resolved arrival tile and the light opens from the centre outward. The selected miniature reforms upright inside the arch, steps into its settled pose and remains as the revived unit while the doorway dissolves; unchosen graveyard cards gain no models or previews.

### Rontás (`rontas`)

- **Form:** A crooked plum thorn pinned through a small ochre disc becomes a curse badge on the recipient. Faint temporary slate petals point outward to distinguish its neighbouring drain from a direct power penalty on the wearer.
- **Animation:** The caster twists the badge into shape and sends it to the chosen unit, where the petals fan once toward currently affected neighbours on both sides. The petals disappear and the badge remains still; the neighbouring −1 power follows the attachment's actual adjacency without wounds, damage chips or permanent gyűrű losses.

### Kegyelemdöfés (`kegyelemdofes`)

- **Form:** A slender steel point with a short dark timber grip supplies a restrained finishing-strike motif. A tiny russet wrist ribbon gives it a readable follow-through without blood or embellishment around existing wounds.
- **Animation:** The caster spots the already-damaged enemy, lowers its weapon and delivers one economical forward thrust. The selected enemy enters the shared fall when destruction resolves, then the point retracts and the caster resets, without adding a separate damage hit or leaving any new attachment on the tile.

### Csábítás (`csabitas`)

- **Form:** A folded plum invitation with a small brass clasp appears beside the chosen unit. A brief pair of curved amber ribbons suggests persuasion, while the quiet invitation acts as the pending-return marker.
- **Animation:** The caster presents the invitation and the ribbons curl toward the target before closing around the clasp and vanishing. The target stays on its tile and side for the ongoing Csata, with the invitation motionless; only the engine's after-Csata return sends it into the caster's hand, using the authorised card movement at that time.

### Fagyos lehelet (`fagyos_lehelet`)

- **Form:** A narrow fan of pale blue faceted breath panels carries small dull teal ice scales. A few low ice scales at the recipient's base represent the lasting power-reduction spell without forming a full immobilising cage.
- **Animation:** The caster leans forward and exhales one tapered gust that spreads gently across the chosen target's shoulders. The target contracts into a colder, subdued pose as −3 power resolves, then the moving breath clears and the scales stay still; there is no damage impact, casting prohibition or prevented movement.

### Lánglándzsa (`langlandzsa`)

- **Form:** A long angular amber spearhead sits on a tapering orange shaft, edged with a few charcoal plates. Its tightly directed silhouette is straighter and denser than either Szikraszilánk or Sárkánytűz.
- **Animation:** The caster draws the shaft back beside its shoulder, then drives the burning lance directly toward the nearby chosen unit. The tip compresses into one bright contact flash as the resolved five-damage hit reacts, after which the shaft fractures into extinguishing facets and leaves no burning loop or weapon attachment.

### Teleport (`teleport`)

- **Form:** Two low paired portal frames use mismatched slate blocks and a muted violet inner plane. Each frame is a temporary open bracket rather than a large gate that obscures units or terrain.
- **Animation:** The caster folds its hands as the source bracket closes inward around the selected ally and the destination bracket opens at the engine-chosen empty tile. The miniature disappears and reforms in a single matched compression and release, then both portals shut, leaving the ally exactly at its resolved position without a walking path or residual gate.

### Eltaposás (`eltaposas`)

- **Form:** Broad dusty earth wedges and a single steel-grey contact crescent support a heavy foot, hoof or body slam. The prop adapts to the caster's anatomy and carries no magical animal apparition.
- **Animation:** The caster lifts its weight and brings one limb or shoulder down toward the weaker chosen enemy in a short grounded drive. The enemy receives the engine-calculated power-gap damage, at least three before mitigation, through one heavy impact reaction; the dust settles and the caster returns to its unchanged tile rather than crossing the board.

### Hydrairha (`hydrairha`)

- **Form:** Three broad interlocking hide plates curl around the caster like a low open-backed shell, in dark moss, teal-grey and ochre seams. Rounded triangular ridges distinguish the Hydra hide from Sárkánypikkelyek's many small scales.
- **Animation:** The plates push outward from the caster's silhouette, overlap once with a deep settling motion and lock together around the flanks. They remain perfectly still as the Sérthetetlen attachment, with the miniature's face visible; any later prevented result gets only a brief resolved deflection accent rather than an automatic looping shield pulse.

### Sárkánytűz (`sarkanytuz`)

- **Form:** A widening tongue of faceted amber flame contains darker russet folds and a short charcoal-edged tail. Its broad cone begins at the caster's mouth or an equivalent forward casting point and narrows visually onto one target.
- **Animation:** The caster draws back its head, opens its jaws and expels one rolling breath that curls across the gap. The chosen unit takes the resolved five-damage impact as the flame closes around it briefly, then all fire clears; the broad shape never implies hits on intervening or neighbouring units.

### Napéjegyenlőség (`napejegyenloseg`)

- **Form:** Two interlocking half-discs, one warm ochre and one cool slate, form a temporary balanced sun at the caster's feet. A shallow band of linen-coloured leaf facets carries the clearing motion across the board.
- **Animation:** The half-discs align and release one even sweep over units on both sides. Removed placed-spell props and their dependent visuals lift away together with existing damage marks, matching the current full-clear effect. Earned gyűrű remain; the facets and discs then clear, and any subsequent falls follow the resolved state after attachments are lost.

### Villámcsapás (`villamcsapas`)

- **Form:** A broken zigzag of chalk-white and pale amber prisms drops from above, with a small slate cloud chip marking its origin for a moment. The strike remains thin enough to preserve the target's silhouette.
- **Animation:** The caster gives one sharp upward point and the cloud chip forms directly over the chosen enemy, avoiding any beam through intervening units. The zigzag snaps downward in two fast segments as the resolved four-damage hit reacts, then collapses into a few cooling sparks and disappears, leaving no weather loop.

### Enyészet (`enyeszet`)

- **Form:** A loose wreath of dry umber leaves and chipped plum plates closes around a small dull ochre core. A compact fallen-leaf tab remains by the recipient as the still marker for the power-reducing spell.
- **Animation:** The caster crumbles the wreath's core and sends its brittle pieces drifting into the chosen unit's silhouette. The miniature sags slightly as −4 power resolves, then the fragments sink and clear around the static tab; no strike, wound or damage chip appears, and a death occurs only through the engine's resolved fall.

### Káoszkolera (`kaoszkolera`)

- **Form:** A squat cracked plum vessel releases angular soot-grey seed shapes in a low uneven wave. The seeds resemble abstract diseased husks, with no spots painted onto bodies or unsettling bodily detail.
- **Animation:** The caster tips the vessel and the husks skip outward across both sides of the board. Only units the engine destroys at current power two or less fold into the shared clean falls, including the caster if applicable; the rest hold position as the wave and vessel dissolve, leaving no continuing disease or damage markers.

### Élősködés (`eloskodes`)

- **Form:** Two brass seed beads hang inside a segmented plum tendril with a dull moss-green tip. Its flexible shape is built from broad wedges rather than a realistic parasite or fleshy tube.
- **Animation:** The tendril reaches toward the chosen unit, briefly closes around its silhouette and draws the two beads back toward the caster. The target's resolved −2 power uses a static withered-seed spell marker while the caster's two awarded gyűrű settle into the shared display; the tendril vanishes without a damage strike or continuing drain.

### Kivirágzás (`kiviragzas`)

- **Form:** Low angular flowers with linen petals, russet centres and moss-green folded leaves bloom along a temporary shallow wave. Each affected ally receives a single brass seed motif that resolves into the shared gyűrű display.
- **Animation:** The caster opens both hands and the flowers unfold in a quick spreading succession across the allied side. One earned gyűrű settles on every engine-resolved allied recipient, then petals fold and disappear, leaving the rings still and independent of the caster rather than a permanent animated garden or a conditional aura.

### Monstrosis (`monstrosis`)

- **Form:** A bulky cocoon of dark timber-like husk plates rises around the caster, edged in muted teal with broad ochre seams. Its heavy hooked silhouette contrasts with Metamorfózis's light leaf wrap without committing to an unchosen Bestia's anatomy.
- **Animation:** Once the eligible Bestia choice is complete, the husk clamps shut, bulges once and splits along three broad seams. The selected creature unfolds into its actual resolved place as the original caster is replaced, then every husk plate dissolves; the transformation never previews the private alternatives or suggests an extra summoned unit.

### Enormorf (`enormorf`)

- **Form:** Three slate measuring brackets with violet inner edges frame the selected miniature, and a small six-sided brass block marks the attachment. Any apparent body growth stays inside the tile's readable silhouette limits.
- **Animation:** The brackets pull apart vertically as the recipient makes one deliberate upward stretch, then contract into the small brass marker. The resolved power becomes six for the attachment's duration, even when that is a reduction; the settled scale and marker remain static, with no gyűrű award or assumption that a larger model gained other abilities.

### Idézés (`idezes`)

- **Form:** An incomplete arch of chunky violet-edged slate blocks surrounds a linen-coloured doorway. Its compact footprint fits the chosen empty adjacent allied tile and leaves the neighbouring caster unobstructed.
- **Animation:** After the hand choice resolves, the caster pulls the two arch halves apart and the selected eligible unit steps through onto the resolved neighbouring tile. The doorway folds shut behind the miniature and its blocks sink away, leaving only the summoned unit and its actual entry consequences; no other hand card appears in the public scene.

### Jéghegy (`jeghegy`)

- **Form:** Three large blue-grey ice buttresses surround the recipient with broad gaps between them, capped by a low pale teal ridge. The cage remains open enough to read the trapped miniature, casting restriction and exact power-one state in the interface.
- **Animation:** A cold wedge travels from the caster and splits under the target, driving the buttresses upward in one enclosing motion. The ice then stays motionless while the attachment provides Sérthetetlen, prevents casting and fixes power at one; no separate movement restriction, freezing loop or damage strike is implied.

### Elmezavar (`elmezavar`)

- **Form:** Three mismatched plum arrowheads revolve briefly over the targeted enemy, with one dull brass direction needle snapping sideways. They are transient thought-confusion geometry rather than a persistent possession crown.
- **Animation:** The caster crosses its fingers and sends the arrowheads into one short conflicting turn above the enemy's head. After the neighbouring allied victim is selected, the confused unit makes a single physical strike against that victim for the engine-resolved damage, then recovers in place as the arrows vanish, with no ownership change or ongoing control marker.

### Lepumorf (`lepumorf`)

- **Form:** A pair of folded plum rabbit-ear shapes brackets a small chalk-coloured faceted puff. The resolved Nyúl uses the same small cream body, warm grey paws and oversized uneven ears as its unit concept.
- **Animation:** The caster pinches the ear shapes together and the puff contracts around the selected unit, briefly concealing its silhouette. The puff opens to reveal the engine's abilityless power-one Állat replacement, which settles into one quick ear-lowering pose; all magical shapes disappear and the rabbit remains still in the same tile.

### Argeo (`argeo`)

- **Form:** A single tall split obsidian-like slate prism hangs inside an angular plum bracket, with a narrow blue core. Its sparse heavy geometry gives the spell a decisive silhouette without skulls, gore or a giant obscuring beam.
- **Animation:** The caster closes its fist and the split prism forms above the chosen unit, descending only a short distance as its two halves meet. On resolved destruction the miniature folds into a clean fall and disappears beneath a collapsing blue seam, then the prism breaks into dull fragments and clears without damage bookkeeping or a continuing curse.

### Homályhimlő (`homalyhimlo`)

- **Form:** A shallow canopy of dark slate facets carries many small plum lozenges like a broken eclipse. The wave is wider and more ordered than Káoszkolera's skipping husks, making this stronger mass removal recognisable at a glance.
- **Animation:** The caster draws the canopy closed overhead, then releases the lozenges in a single descending sweep across both armies. Only engine-resolved units at current power three or less enter the clean fall, including the caster when applicable, and the canopy clears immediately without marking survivors as infected or creating ongoing damage.

### Nyirokhold (`nyirokhold`)

- **Form:** A large muted ivory crescent cradles two slate-blue seed lanterns, with plum supports shaped like bent reeds. Two small open arches repeat its shape at the resolved revival positions.
- **Animation:** After the eligible graveyard choices resolve, the caster raises the crescent and sends one lantern toward each selected unit's arrival tile. Each chosen miniature reforms through its own arch in a short staggered sequence, then the moon and lanterns clear, leaving exactly the revived units without displaying unselected cards or maintaining a night-sky effect.

### Valóságtörés (`valosagtores`)

- **Form:** A suspended faceted violet frame splits into large offset slate panes, each carrying a thin amber seam. The illusion of broken space comes from separated solid geometry rather than screen distortion or a texture.
- **Animation:** The caster pulls the frame apart and one clean fracture wave passes across the entire board. Only units the engine destroys for carrying a placed spell break into the shared fall, regardless of side, while unmarked survivors remain intact; the panes fold into the seams and vanish, leaving neither portals nor continuing battlefield changes.
