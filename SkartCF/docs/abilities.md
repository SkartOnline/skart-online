# Képességleltár — mit csinálnak a lapok

Ez a dokumentum a Skart lapkészletének teljes képességelemzése. Minden egység-,
varázslat- és csatatérszöveg vissza van vezetve egy **paraméterezett alapelemre**.
A motor sosem ágazik el lapazonosítón: egy lap adatsor, ami megnevez egy `kind`-ot
és a paramétereit. Új, hasonló lap készítése a szerkesztőben ezért mindig
paraméterállítás, nem kódolás.

Három tábla van, mind a `schema.ts`-ben deklarálva, és mind a hármat ugyanaz a
szerkesztő-űrlap generálja:

| Tábla | Mikor fut | Hol |
|---|---|---|
| `STATIC_SPECS` | folyamatos, olvasáskor számolva | `power.ts` |
| `EFFECT_SPECS` | egyszer, elsüléskor | `effects.ts` |
| `LOCATION_EFFECT_SPECS` | a csatatér teljes ideje alatt | `power.ts` / `reducer.ts` |

---

## 1. Állandó képességek (`statics`)

Tizennégy alapelem fedi le mind a 88 egység összes folyamatos képességét.
Az attachment-lapok (ráakasztott varázslatok) **ugyanezeket** hordozhatják, ezért
a Falanx, a Vérszomj, a Halálfélelem és a Csordaszellem nem igényel külön kódot.

| Alapelem | Paraméterek | Mit fed le |
|---|---|---|
| `powerBonus` | `amount`, `condition`, `value` | Vízköpő, Hetvenkedő katona, Sir Werdzsell, Medve, Ninja, Guner, Vérfarkas, Cassanus, Felindori íjász (Távolsági), Falanx, Kopja, Halálfélelem |
| `countBonus` | `amount`, `side`, `scope`, `keyword`, `requires`, `atLeast` | Farkas, Papagáj, Zsalu, Bárkakedvenc, Piráto Sanchez, Korgon, I. Iniquus, Vérszomj |
| `aura` | `amount`, `side`, `scope`, `keyword`, `maxBasePower`, `atLeastCount` | Kovács, Altus, Lényidomár, Maffiavezér, Simorf, Welsing, I. Iniquus, Csordaszellem, Egységben az erő |
| `auraGrant` | `side`, `scope`, `grant`, `keyword`, `cardId` | Kém, Bol'Jin, Fehér Pásztor, Welsing |
| `selfGrant` | `grant`, `condition`, `value` | Fehér Pásztor, A Moirák, Cassanus, Umbradog, Sárkánypikkelyek, Füstbomba, Odú |
| `powerFloor` | `side`, `scope` | Faun |
| `redirectSpells` | `side`, `scope` | Dionzosz |
| `suppressOpposed` | `condition` | Vérfarkas |
| `spellMod` | `what`, `amount`, `tag`, `school` | Explodus, Erif mester |
| `freeCasts` | `count` | A Moirák |
| `banCasting` | — | Omen |
| `placementRule` | `requireAdjacentKeyword` | Papagáj |
| `selfRestrict` | `restrict` | Némítás, Indák, Kötél, Szorítás, Elfeledés |
| `powerOverride` | `mode`, `value` | Természetes forma, Enormorf |
| `damageCap` | `amount`, `side`, `scope` | A Faarcú — egy hatás legfeljebb ennyit sebez |
| `castRing` | `amount`, `side`, `keyword` | Elfina — a megcélzott szövetséges Állat gyűrűt kap |

### A `condition` felsorolás

Egyetlen feltétel-enum szolgálja ki a `powerBonus`-t és a `selfGrant`-ot:
`always`, `frontRow`, `backRow`, `enemyHalf`, `noHidden`, `opposedOccupied`,
`opposedEmpty`, `opposedWeaker`, `opposedStronger`, `isolated`,
`isolatedDiagonal`, `aloneInRow`, `aloneInFrontRow`, `aloneOnBoard`, `immobile`,
`graveyardAtLeast`, `noPlacedOnMe`.

Új „+X, ha …” egység készítése tehát mindig: `powerBonus` + a megfelelő feltétel.

---

## 2. Hatások (`effects`)

Egyszer sülnek el: Belépőből, kiváltóból (`triggers`), vagy egy kijátszott
varázslatból a csata fázisban.

### Tábla-hatások
`modifyPower`, `setPower`, `damage`, `destroy`, `massDestroy`, `move`,
`swapWithAdjacent`, `transform`, `attach`, `grantImmunity`, `fizzleShield`,
`lock`, `summon`, `thresholdAoe`, `grantRing`, `duel`, `devour`, `advance`,
`modifySpellpower`, `revealHidden`, `clearPlaced`.

A `damage` mennyisége háromféleképpen jöhet: `amount` a fix szám;
`altAmount` + `altIf` a második szám, ha a feltétel a megcélzott egységre igaz
(Hátbaszúrás 2, a hátsó sorban 4); `casterPowerDiv` pedig a varázsló erejéből
származtatja (Eltaposás: a fele, felfelé kerekítve). A `fizzleShield`
`maxCost: 0` értéke azt jelenti, hogy **nincs** költséghatár — az Álomfogó és az
Omnifex a következő rá szálló varázslatot nyeli el, akármennyibe került.

### Lapgazdálkodási hatások
`draw`, `discard`, `searchDeck`, `revive`, `returnToHand`, `stealCard`,
`bounceToDeckBottom`, `swapHandGraveyard`, `drawNextLocation`, `coinFlip`,
`peek`, `handSwap`, `setTrap`, `portal`, `note`.

### Hatások, amelyek kérdeznek

A legtöbb hatásnak nem kell kérdeznie: ha a lap szövege azt mondja, hogy „egy",
és a választás nem érdekes, az adat megmondja, melyik — erre való a `pick`.
Ahol viszont maga a választás a képesség, ott kérdez:

| Alapelem | Mit kérdez | Lap |
|---|---|---|
| `searchDeck` | melyik lap jöjjön ki a kilistázott pakliból vagy temetőből | Sírásó, Feltámadás, Lingadori könyvtár |
| `handSwap` | melyik lapokat húzod el, majd melyiket adod vissza | Griff, a hamiskártyás |
| `setTrap` | melyik varázslat megy le, és melyik ellenséges mezőre | Fuedrax |

Ezek egy `Prompt`-ot tesznek a sorba (`prompts.ts`) és megállnak; amíg meg nincs
válaszolva, a játékban semmi más nem történhet. A válasz közönséges akcióként
érkezik (`answerPrompt`, `finishPrompt`), ezért a bot és a szimulátor ezeket a
lapokat is le tudja játszani anélkül, hogy tudnának a létezésükről. A lezárás
`kind` szerinti kezelő az `interactions.ts`-ben, sosem closure — a prompt túl
kell hogy élje a `structuredClone`-t, amivel a bot pozíciót értékel.

Ez a három az első kérdező hatás, nem az egyetlen, amire a gépezet való. Egy új
kérdező képesség egy prompt-`kind` és egy lezáró kezelő — ugyanaz a két szerkesztés,
mint egy új hatásnál —, a motorban semmi másnak nem kell tudnia róla.

A `peek` nem kérdez, de `Reveal`-t ír: mit láttak és ki jogosult látni. A
`portal` sem kérdez, csak feljegyzi, hogy hol állt az egység, amikor a csata
eldőlt.

### A célzószűrő az, ami az ölő varázslatokat egyetlen alapelemre hozza

Az Óriásölő, a Fojtás, a Rajtaütés, a Kegyelemdöfés és a Carnifex mind
`destroy` — csak a szűrőjük más:

| Lap | Szűrő |
|---|---|
| Óriásölő | `minPower: 8` |
| Fojtás | `maxPower: 3` |
| Rajtaütés | `isolated: true` |
| Kegyelemdöfés | `damaged: true` |
| Carnifex (Belépő) | `maxBasePower: 4` |
| Valóságtörés | `hasPlaced: true` (tömeges) |

A `TargetFilter` mezői: `keyword`, `keywords` (bármelyik), `notKeyword`,
`maxCost`, `minCost`, `maxBasePower`, `minBasePower`, `maxPower`, `minPower`,
`damaged`, `isolated`, `hasPlaced`, `hidden`, `row`, `weakerThanCaster`.

Minden hatás ugyanazt a három kaput kapja meg: `if` (+ `ifValue`) a fenti
feltétel-enumból, valamint `ifKeyword` és `ifNotKeyword` kulcsszóra. A Sújtás
ezekből áll össze: 3 sebzés `ifKeyword: "Élettelen"`, 1 sebzés
`ifNotKeyword: "Druida,Állat,Élettelen"`, a természet gyermekeinek pedig semmi.

---

## 3. Kiváltók (`triggers`)

A Belépőn kívül öt esemény létezik. Ez teszi lehetővé a **gyűrűt**: olyan
erőt, amit egy feltétel adott, és a megajándékozott akkor is megtartja, ha az
adományozó már nincs a táblán.

| Esemény | Lapok |
|---|---|
| `onAnyDeath` | Temetkezési vállalkozó |
| `onAllyMove` | **Bodur kapitány** — a mozgó szövetséges gyűrűt kap |
| `onMustra` | Szarvas — a felfedéskor nyomul előre, kész táblára; Októ-abnormitás — ekkor mérlegeli, mit falhat fel |
| `onLocationWon` (Diadal) | Kincskereső |
| `onLocationLost` (Vigasz) | Makacs élőhalott, Felix |

**A Diadal és a Vigasz nem haláleffekt.** Mindkettő azt nézi, hogy az egység a
csatatéren áll-e, amikor a csata eldől: a Diadal a győztesnek fizet, a Vigasz a
vesztesnek. Döntetlennél egyik sem sül el, mert senki nem nyert és senki nem
vesztett. Önálló „amikor meghalok" kiváltó szándékosan nincs.

A `scope: "trigger"` célzás az eseményt kiváltó egységre mutat.

### Gyűrű (`rings`)

`UnitInstance.rings` egy szám. Beleszámít a `power()`-be, **nem** függ az
adományozótól, és a táblán ⊙ jellel jelenik meg. Forrásai: `grantRing` hatás
(Bodur, Temetkezési vállalkozó, Szarvas, Hajnalmadár, Azman, Októ, Lélekszipoly,
Vadász, Varjú, Fejvadász, Szerencsejátékos) és a Vaskarom, ami gyűrű-jelölt
ráakasztott lap.

---

## 4. Ráakasztott lapok (varázslat az egységen)

Minden tartós hatású varázslat egy egységre kerül. `UnitInstance.placed` őrzi az
összes ráhelyezett varázslatot — a tartósakat is, az egyszer elsülőket is —,
ezért lebegtetéskor mindegyik látszik. A tartós hatás az `attachment` mezőn
keresztül kap mechanikát, és a lap levétele megszünteti (Tisztítás, Vedlés,
Napéjegyenlőség).

Egy ráakasztott lap `statics` tömböt hordozhat, tehát ugyanazt a tizennégy
alapelemet használja, mint az egységek.

---

## 5. Csatatér-hatások

| Alapelem | Csatatér |
|---|---|
| `flatBonus` | Holdfényes tisztás (+1), Elátkozott rengeteg (−1) |
| `keywordBonus` (`row`, `invert`) | Akáczos |
| `strongestPenalty` | Sikátor |
| `autoHide` | Feketepiac (Csempész), Ködrét (mind) |
| `hideCostMod` | Feketepiac |
| `blockedSlots` | A Pék hídja |
| `spellCostMod` | Máguskör |
| `costMod` | Kikötő (Kalóz) |
| `rangeCap` | Ködrét |
| `suppressPositional` | Ködrét (Távolsági) |
| `playFromGraveyard` | Umbra |
| `salvage` | Plázs — a Felindori egységek a pakli aljára kerülnek leszereléskor |
| `startEffect` | Lingadori könyvtár, Malom, Bőségkert |
| `perCost`, `costAtMostBonus`, `rowBonus`, `schoolSpellpowerBonus` | tartalék, szerkesztőben elérhető |

---

## 6. Varázsiskolák

Hat iskola: **Mágus, Feketemágus, Harcos, Zsivány, Druida, Bestia.**

Két régi név eltűnt. Az `Állat` varázsiskola **beolvadt a Bestiába** — minden
korábbi „Állat N” varázserő „Bestia N” lett —, a `Ravaszság` pedig **`Zsivány`
lett**, ahhoz a rendhez igazodva, amelyikhez tartozik. Mindkettő *kulcsszóként*
él tovább, varázserő-készletként soha.

Egy varázslat több iskolát is megnevezhet (`schools: string[]`); a varázsló az
egyikből fizet, teljes egészében. Nincs összeadás iskolák vagy egységek között.
Ilyen a Kegyelemdöfés (Harcos, Zsivány).

A lapon négy kulcsszó-oszlop van — Eredet, Rend, Faj, Extra tag —, a motorban
`origin`, `order`, `race` és `keywords`. A `cardKeywords()` mind a négyet egyetlen
listába olvasztja, ezért egyetlen szűrőnek sem kell tudnia, melyik oszlopból jött
a szó.

A `tags` mező adja a varázslat elemét: `Tűz`, `Fagy`, `Mesteri`. Erre hivatkozik
a Tűzköpeny, a Fagypáncél, az Explodus és az Erif mester.

---

## 7. Ami tudatosan szövegként maradt

Egyetlen ilyen lap maradt. A többi megkapta a gépezetét: a kérdező hatások a
`Prompt`-sort, a csapda és a portál a saját zónáját, a betekintések pedig a
`Reveal`-t, ami a felfedett lapot ténylegesen kirakja a képernyőre annak, akit
megillet.

| Lap | Miért |
|---|---|
| Gouraldir | a Három Ereklye lap nem létezik a készletben |

Ami időközben elkészült:

| Lap | Alapelem |
|---|---|
| Fuedrax | `setTrap` — a varázslat a `state.traps`-ban ül, és arra sül el, aki rálép; szövetségesre is |
| Felix, a Hajnali Utas | `portal` — a Vigasz feljegyzi a mezőt, a leszerelés átviszi a következő csatatérre, tisztán és a kereten kívül |
| Griff, a hamiskártyás | `handSwap` — két kérdés: mit húzol el, aztán mit adsz vissza |
| Mágusinkvizítor, Gréta, Leskelődés | `peek` — a felfedett lapokat a betekintő játékos képernyőjén tartja |
| Fejvadász | `peek` + `ringIfCostlier` — egy véletlen lap fordul ki a kézből, és ha drágább nála, gyűrűt hoz |
