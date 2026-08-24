# Skart — tervezési és építési jegyzetek

Ez a dokumentum **nem szabályzat**. A szabályokat egyedül a `szabaly-teljes.md`
mondja meg, vitás helyzetben az dönt, és a motor is ahhoz igazodik. Itt csak az
áll, amiért a szabályok olyanok, amilyenek, plusz a böngészős prototípus
felépítése.

Ez a fájl a korábbi `rules-v2.md` helyére lépett. Abban a szabályok és a
tervezési indoklás egy dokumentumban álltak, és a szabályrésze már elavult volt
(a rejtés árától a leszerelésig több pont megváltozott), ezért a szabályok
átkerültek a teljes szabályzatba, és csak ez a fele maradt meg.

---

## Miért így dől el a csata

### A megállás drága

Nincs passzolás, csak befejezés, és a befejezés végleges (6.6.3, 8.7.3). Mivel
vissza nem lehet lépni, a gyülekezés befejezése pontosan megmondja az
ellenfélnek, mit kell megvernie, és megengedi neki, hogy a lehető legkisebb
ráfizetéssel verje meg. Túl korán állsz meg egy csatatéren, amit nem akartál, és
egy patkánnyal elviszik. Túl későn állsz meg, és túlköltötted magad egy összegbe,
amit egyszerűen nem hajlandók megmatchelni.

Ez teszi a csatatér feladását valódi döntéssé, amit a passzolás soha nem tett
meg. Ugyanez büntethetővé teszi a túlköltést is: az ellenfél megállhat alattad,
és megtartja a lapjait.

Attól nem válik megoldott számtanpéldává, hogy a látható összeg nem az igazi
összeg. A rejtett egységek kívül állnak rajta, és minden kézben maradt varázslat
is. Tizennégynél megállni egy látható tizenöt ellen rendben van, ha három
varázslatod van a csatafázisra, és ezt az ellenfél nem tudhatja.

### A két bejelentés két különböző dolgot mond

A gyülekezés befejezése azt mondja meg, milyen táblát kell megverni. A
csatafázis befejezése a hangosabb a kettő közül, mert ott áll meg véglegesen az
összeg: amíg bármelyik játékosnál van nyitott varázslat, minden szám az asztalon
ideiglenes.

Mivel a varázslatok kijátszáskor azonnal lefutnak, a csatafázis élő adok-kapok,
nem zárt licit. Elsőnek varázsolni információba kerül — előbb mutatod meg a
lapot és a célpontot, mint ő —, és ez az ellensúlya annak, hogy a gyülekezésben
is te kezdesz.

### A geometria nem véd meg

Minden mező elérhető 2 hatótávról pontosan egy ellenséges első sorbeli mezőről.
Semmi nincs sosem hatótávon kívül. A hátsó sarok azt vásárolja meg, hogy a
legrosszabb eset 4 lesz 3 helyett, és hogy csak egyetlen ellenséges pozícióból
jön rá olcsó lövés.

A védelem ezért nyílt lerakásból jön, nem a geometriából. Látod, hol állnak a
varázslóik, tehát a sarokba tett bomba olvasás kérdése, és ha a varázslót előbb
kötötték le, nem tudják visszavenni.

Az első középső mező a legkitettebb a táblán (1/2/2). Az első sarkok egy
hatótávot adnak egy biztonsági lépésért. A hátsó sarkok a menedék, rövid
hatótávért és kevesebb szomszédsági bónuszért.

---

## Tartalmi tervezési szabályok

### Varázslatok

A sebzés maradandó −X jelölő az egységen. Sosem azonnali vereség, és sosem
visz át sebet a következő csatatérre. A nullára sebzés öl, és az egység azonnal
lekerül a mezőjéről.

A sebzés nem számít bele az összesítésbe. Ez választja el a két eltávolítási
stílust: a −2 mindig elmozdítja az összehasonlítást, a sebzés viszont holt teher,
amíg át nem lépi a határt.

A területhatás mindig küszöbhatás, sosem elosztott sebzés. „Minden legfeljebb X
erejű ellenséges egység −Y” egyetlen halmazként olvassa a táblát. Magától
skálázódik, szétveri a nyüzsgést, üresen csattan egy értékalapú táblán, és nem
kell hozzá semmit nyilvántartani. Sosem „sebezz X-et több egységbe”.

A ráhelyezett lapok „amíg X rajta van” megfogalmazást használnak. A fizikai lap
az egységen maga a hatás, tehát a lap levétele leveszi a hatást is. Nincs
időtartam-nyilvántartás.

Az erőt beállító hatások felülírják a nyomtatott értéket, nem módosítják
(Jéghegy 1-re állít, Enormorf 6-ra), hogy elkerüljük a halmozódási számolást.

Egy célpontra inkább erőgyengítés, mint küszöbsebzés. A −2 mindig elmozdítja az
összehasonlítást, a sebzés halott, amíg nem lép át a nullán.

Tilos: gyógyítás, körönként növekvő sebzés, varázslatot módosító varázslat.

### Költséggörbe

A költség független az erőtől. Az Ogre 7 erő 6 költség, egy arkánmágus 3 erő 7
költség, a patkány 1 erő 1 költség. Egyetlen szám sem rangsorolja az összes
egységet, és pontosan ez akadályozza meg, hogy a testtel-nyüzsgés vagy az
egy-nagy-lap érték automatikusan nyerjen.

| Költség | Szint |
|---|---|
| 0–1 | patkány, koldus, csirke (ágyútöltelék) |
| 2 | polgár, tolvaj, milícia, farkas |
| 3 | íjász, könnyű dárdás |
| 4 | hivatásos katona (Felindori kardforgató), az alapvonal |
| 5 | veterán, lovag, medve |
| 6 | ogre, troll, bajnok |
| 7–8 | hadúr, vérfarkas, griff |
| 9–10 | óriás, wyvern |
| 11–12 | Gouraldir-szint |
| 13–14 | félistenek |
| 15+ | istenek |

A skála alul össze van tömörítve, tehát a +1 arányosan hatalmas az olcsó
egységeknek, és zaj a tetején. A pozíciós és a csoportbónuszok ezért számtani
okból tartoznak a nyüzsgő véghez, szabály nélkül.

A varázslókat külön árazzuk. Egy arkánmágus 2 erő, 7 varázserő.

### Balanszőrök

A csatatérhatások a hatékonyságot és a jutalmat billentik, sosem kapuzzák a
laptípusokat. „+1 minden költségpontért itt” rendben van. „Olcsó egységet nem
lehet ide játszani” tilos.

A cél billentés **3–6 pont elmozdulás a favorizált pakli irányába egy tipikus
táblán.** Ennyi elég, hogy számítson egy 8-as keret melletti csatában, és annyira
kevés, hogy a jobb hadsereg, a jobb varázslás vagy egy jól időzített megállás
megverje.

**Kemény hibakritérium: ha bármelyik pakli bármelyik csatatéret 75%-nál
gyakrabban nyeri, az a csatatér vagy az a pakli el van törve, és azonnal
változik.** Ezt a számot méri a szimulátor.

Miért kemény vonal és nem preferencia: mind a hat csatatér nyilvános az első
körtől. Ha a te három tábláddal biztosan te nyersz, az enyémmel biztosan én,
akkor mindkettőnknek az a helyes játék, hogy mind a hatot feladjuk egy-egy
patkánnyal, 3-3 lesz, és két majdnem teli paklit borítunk a Végtelen pusztára. Az
első hat csatatér formalitássá válik. Egy ellenséges tábla ellopása 4-2-t
jelent, és korán lezárja a játékot, tehát az ellenséges terepnek nyerhetőnek kell
maradnia, különben az egész szerkezet egyetlen csatává omlik össze.

Figyeld, a próbajátékok mekkora része jut el a Végtelen pusztáig. Ha a többségük,
a billentés túl erős.

A hat mező felső korlátot tesz arra, mennyit fizet a feladás. Aki húsz lapot
bankolt, az is hat egységet állít ki a Végtelen pusztán, tehát minden a kézben
lévő legjobb hat lapon túl holt teher. A feladás válogatást vásárol, nem
mennyiséget.

A tapogatózás a természetes ellenszer, és maradjon olcsó. Egy egység az ő
táblájukon rákényszeríti őket a költésre; ha túlreagálják, megállsz, és egy
lapért elveszted a csatateret, míg ők négyet elégettek.

Három patkány egy csatatéren szándékosan rossz. Ágyútöltelék a
területhatás-erősítő és a létszámszorzó egységekhez, nem önmagában nyerő játék.

---

## Nyitott próbajáték-kérdések

1. Megöli-e az olcsó mozgás a pozíciós területhatást? Ha egy 1 költségű csúszás
   minden alkalommal kikerül egy 6 költségű sorletörlőt, akkor a területhatásnak
   erőküszöbre kell támaszkodnia, nem sorokra.
2. Hét lapos varázslatkézzel és nyílt egységekkel túl konzisztens-e az
   eltávolítás? A fogantyú a varázserő és a hatótávtábla. Ha a tábla legjobb
   egysége mindig meghal, a varázserőt kell szorítani, nem a hatótávot.
3. Egyenrangúnak tűnnek-e a varázslatok az egységfázissal, vagy körethez adott
   köretnek? Az egészséges az, ha a hadseregek döntik el a legtöbb csatát, és a
   varázslatok a szorosakat. Ha a varázslatok döntenek el mindent, az
   egységlerakás dekoráció.
4. Nyílt és soros csatafázisban szigorúan jobb-e másodiknak lenni? Minden
   varázslat megmutatja a célpontját a válasz előtt, tehát az utolsó varázslóé az
   utolsó szó. Figyeld, elkezdenek-e a játékosok versenyezni azért, hogy ők
   mondják ki utolsónak a csatafázis végét.

---

# Technikai jegyzetek

Cél: böngészős prototípus, először egyedüli teszteléshez és
balansz-szimulációhoz, másodszor hotseat játékhoz, hálózati többjátékos csak
akkor, ha a szabályok megálltak.

## Rétegek

TypeScript, React, Vite, játékmotor nélkül. A tábla tizenkét div. Statikusan
deployol.

## Az architektúra, az egyetlen dolog, ami számít

A szabálymotor tiszta függvényként él a `src/engine/`-ben, nulla React importtal.
A React csak állapotot rajzol és akciókat küld.

```
engine/
  types.ts        állapot, lap, hatás típusdefiníciók
  grid.ts         mezőszomszédság, hatótávtábla
  reducer.ts      applyAction(state, action) => state
  resolve.ts      varázslatlefutási gép
  effects.ts      egy kezelő hatásfajtánként
  power.ts        alaperő, aktuális erő, statikus képességek
  totaling.ts     összesítés
data/
  units.json
  spells.json
  locations.json
ui/
sim/
  run.ts          fejnélküli N-játék futtató
```

A szétválasztás oka nem a rendszeretet. Az ok az, hogy egy fejnélküli
szkriptnek le kell tudnia játszani tízezer játékot, és jelentenie kell a
győzelmi arányt csatatérkeret, pakli-archetípus és „ki köt le előbb” szerint. Ez
az igazi hozadéka annak, hogy ezt megépítjük ahelyett, hogy még több papírt
nyomtatnánk, és lehetetlen, ha a szabályok komponensekben élnek.

## A lapok adatok, sosem kód

Minden lap egy JSON sor, ami megnevez egy hatásfajtát és a paramétereit. A
motorban nincs lapazonosítóra ágazás. Az egyetlen deklaráció a `schema.ts`, amit
két fogyasztó olvas: a `cards.ts` betöltéskor ellenőriz vele, a beépített
lapszerkesztő pedig ebből generálja az űrlapjait. Új hatásfajta ezért pontosan
két szerkesztés: egy `KindSpec` a sémában és egy kezelő az `effects.ts`-ben.

Az újrabalanszolás így egy szám átírása JSON-ban, nem kódszerkesztés.

## Két érték-olvasó

A motornak két, sosem összekeverhető olvasója van:

- `basePower(unit)` a nyomtatott értéket adja (vagy a felülíró értéket)
- `power(unit, state)` a nyomtatott értéket plusz a pozíciós bónuszokat plusz a
  csatatérhatást plusz a statikusokat plusz az aurákat plusz a gyűrűket plusz a
  ráhelyezett lapokat plusz az egyszeri módosításokat, nullára vágva

Minden hatás megmondja, melyiket olvassa, egyenesen a lapszövegből. A
küszöbös területhatásnál és a haláltesztnél harap ez a legélesebben.

## Hatótáv

Egyszer felépítünk egy tizenkét csúcsú gráfot: hat saját mező, hat ellenséges
mező, az első sorok élben összekötve az arcvonalon át. Az él súlya 1, majd
szélességi keresés. A teljes 12×12 távolságmátrix indulásnál kiszámolódik, és
onnantól csak indexelünk bele. A szabályzat 4.6 táblázata unit testként van
leírva.

## A varázslatlefutás a nehéz rész

A lefutás nem lehet egyetlen függvényhívás, mert a célpontot és a varázslót
lefutás közben választják. Ezért explicit gép: a motor addig lép, amíg bemenetre
nem szorul, beparkolja a kérést, és megáll. A hívó megadja a választást, a motor
alkalmazza, és tovább lép. Az elszállás nem különleges eset, egyszerűen „nincs
érvényes varázsló”, ami kérdés nélkül tovább viszi a kurzort. A szimulátor
politikafüggvényből adja a válaszokat ember helyett.

Ezt a formát az elején kell eltalálni. Utólag aszinkron hívásokra ráhúzni
nyomorúságos.

## A megállás jelzői az állapotban

Játékosonként két bool, nem körszámláló, és a kettő különböző fázishoz tartozik:

```ts
type Flags = { unitsClosed: boolean; spellsClosed: boolean };
```

A `legalActions(state, player)` üres tömböt ad, ha a játékos befejezte a futó
fázist, és a körsorrend átlépi, nem pedig lezárja a fázist. A gyülekezés akkor ér
véget, ha mindkét `unitsClosed` igaz, ami lefuttatja a Mustrát és megnyitja a
csatát; a csata akkor, ha mindkét `spellsClosed` igaz, ami összesíti a csatateret.
Az automatikus lezárást (üres kéz, tele rács, nincs kijátszható lap, Omen a
táblán) a motor ellenőrzi minden akció után, nem a felület, hogy a szimulátor és
a hotseat ugyanazt lássa.

Ez egyben a legtisztább hely az MI politikai fogantyúinak, mert a „mikor álljak
meg” a játék legfontosabb döntése, és az, amit leginkább végig akarsz söpörni
paraméterértékeken.

## A műveletek sorrendje, kódolva

1. A lerakás azonnal elsüti a Belépőt, kivéve a lefordítva letett egységnél.
2. A Mustra egyszerre felfordítja a rejtett egységeket, majd a Belépőik és a
   Mustra képességek egyenként sülnek el, mezők szerinti sorrendben (E1, E2,
   E3, H1, H2, H3), a két játékos között váltakozva, azzal kezdve, aki a
   csatateret hozta.
3. A varázslatok kijátszási sorrendben futnak le, mindegyik teljesen befejezve,
   mielőtt a következő elkezdődne.
4. Az összesítés a végállást olvassa.

A statikus képességeket sosem alkalmazzuk állapotmódosításként. Olvasáskor
számolódnak, a `power()`-en belül. Ettől jön ki ingyen az, hogy „egy egység
megölése megerősíti a túlélőket”, újraszámolási horgok nélkül.

## Lapkép és teljesítmény

Nem probléma. Hatvan-kilencven kép 400px széles WebP-ben valahol 2–5 MB, ami egy
közepes fotó. A böngésző észrevétlenül komponál több százat; a képernyőn
egyszerre lévő tizenkettő semmi.

Az egyetlen, ami gondot okozna, ha 3000px-es PNG-ket dobnánk be egyenesen egy
művészeti exportból. Build időben egyszer át kell méretezni, és többé nem kell
rá gondolni.
