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
| `countBonus` | `amount`, `side`, `scope`, `keyword`, `requires`, `atLeast` | Farkas, Papagáj, Zsalu, Bárkakedvenc, Piráto Sanchez, Korgon, I. Iniquus, Októ-abnormitás, Vérszomj |
| `aura` | `amount`, `side`, `scope`, `keyword`, `maxBasePower`, `atLeastCount` | Kovács, Altus, Lényidomár, Maffiavezér, Simorf, Welsing, I. Iniquus, Csordaszellem, Egységben az erő |
| `auraGrant` | `side`, `scope`, `grant`, `keyword`, `cardId` | Kém, Bol'Jin, Fehér Pásztor, Welsing |
| `selfGrant` | `grant`, `condition`, `value` | Fehér Pásztor, A Moirák, Cassanus, Umbradog, Sárkánypikkelyek, Füstbomba, Odú |
| `powerFloor` | `side`, `scope` | Faun |
| `redirectSpells` | `side`, `scope` | Dionzosz |
| `suppressOpposed` | `condition` | Vérfarkas |
| `spellMod` | `what`, `amount`, `tag`, `school` | Explodus, Erif mester |
| `freeCasts` | `count` | A Moirák |
| `banStacking` | — | Omen |
| `placementRule` | `requireAdjacentKeyword` | Papagáj |
| `selfRestrict` | `restrict` | Némítás, Indák, Kötél, Szorítás, Elfeledés |
| `powerOverride` | `mode`, `value` | Természetes forma, Enormorf |

### A `condition` felsorolás

Egyetlen feltétel-enum szolgálja ki a `powerBonus`-t és a `selfGrant`-ot:
`always`, `frontRow`, `backRow`, `enemyHalf`, `noHidden`, `opposedOccupied`,
`opposedEmpty`, `opposedWeaker`, `opposedStronger`, `isolated`,
`isolatedDiagonal`, `aloneInRow`, `graveyardAtLeast`, `noPlacedOnMe`.

Új „+X, ha …” egység készítése tehát mindig: `powerBonus` + a megfelelő feltétel.

---

## 2. Hatások (`effects`)

Egyszer sülnek el: Belépőből, kiváltóból (`triggers`) vagy a rakásról.

### Tábla-hatások
`modifyPower`, `setPower`, `damage`, `destroy`, `massDestroy`, `move`,
`transform`, `attach`, `grantImmunity`, `fizzleShield`, `lock`, `summon`,
`thresholdAoe`, `grantRing`, `duel`, `devour`, `advance`, `modifySpellpower`,
`revealHidden`, `clearPlaced`.

### Lapgazdálkodási hatások
`draw`, `discard`, `searchDeck`, `revive`, `returnToHand`, `stealCard`,
`bounceToDeckBottom`, `swapHandGraveyard`, `drawNextLocation`, `coinFlip`,
`peek`, `note`.

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
`damaged`, `isolated`, `hasPlaced`, `hidden`.

---

## 3. Kiváltók (`triggers`)

A Belépőn kívül négy esemény létezik. Ez teszi lehetővé a **gyűrűt**: olyan
erőt, amit egy feltétel adott, és a megajándékozott akkor is megtartja, ha az
adományozó már nincs a táblán.

| Esemény | Lapok |
|---|---|
| `onDeath` (Vigasz) | Makacs élőhalott, Felix |
| `onAnyDeath` | Temetkezési vállalkozó |
| `onAllyMove` | **Bodur kapitány** — a mozgó szövetséges gyűrűt kap |
| `onLocationWon` (Diadal) | Kincskereső |

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
| `startEffect` | Lingadori könyvtár, Malom, Bőségkert |
| `perCost`, `costAtMostBonus`, `rowBonus`, `schoolSpellpowerBonus` | tartalék, szerkesztőben elérhető |

---

## 6. Varázsiskolák

Hat iskola: **Mágus, Feketemágus, Harcos, Ravaszság, Druida, Bestia.**

Az `Állat` varázsiskola **beolvadt a Bestiába** — minden korábbi „Állat N”
varázserő „Bestia N” lett. Az `Állat` *kulcsszóként* (Eredet) továbbra is él, és
attól még külön dolog, mint a `Bestia` eredet.

Egy varázslat több iskolát is megnevezhet (`schools: string[]`); a varázsló az
egyikből fizet, teljes egészében. Nincs összeadás iskolák vagy egységek között.
Ilyen a Kegyelemdöfés (Harcos, Ravaszság).

A `tags` mező adja a varázslat elemét: `Tűz`, `Fagy`, `Mesteri`. Erre hivatkozik
a Tűzköpeny, a Fagypáncél, az Explodus és az Erif mester.

---

## 7. Ami tudatosan szövegként maradt

Ezek a motor jelenlegi állapotában nem gépesíthetők; a lap létezik, a szöveg
olvasható, de mechanikát nem kap. Mindegyik `note` hatással van megjelölve.

| Lap | Miért |
|---|---|
| Fuedrax | csapdaként lehelyezett varázslat — új zóna kellene a rakás mellé |
| Felix, a Hajnali Utas | átvitel a következő csatatérre, keret nélkül |
| Gouraldir | a Három Ereklye lap nem létezik a készletben |
| Griff, a hamiskártyás | kézcsere mindkét irányban, játékosi választással |
| Mágusinkvizítor, Fejvadász, Greta, Leskelődés | tiszta információ — hotseatben a „Mindent mutat” kapcsoló adja |
