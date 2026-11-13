# Lapszöveg — hogyan szól egy Skart-lap

Ez a jegyzet nem szabály. Azt rögzíti, hogyan fogalmazunk, hogy minden lap
ugyanazon a hangon szóljon. Új lap írásakor vagy régi átírásakor ezt kell
követni; a szövegek a `src/data/*.json` fájlok `text` mezőjében állnak.

## Ki beszél

**Az egység és a varázslat egyes szám első személyben beszél.** Az egységlapon
maga az egység szól, a varázslatlapon az az egység, amelyik éppen varázsolja.

- „+1 erőt kapok.” „Megölök egy sérült ellenséget.” „Egy szomszédos üres mezőre
  lépek.”
- Soha nem „az egység +1 erőt kap” önmagáról, és soha nem többes szám, kivéve ha
  valóban többen vannak: „mindhárman +1 erőt kapunk”.

**A játékost a lap tegezi.** Ami a játékos dolga — húzni, eldobni, választani —,
az második személyben áll.

- Amit meg kell tennie, az felszólítás, felkiáltójellel: „Húzz egy varázslatot!”
  „Dobj el egy lapot a kezedből!”
- Amit megtehet, az kijelentés, ponttal: „Eldobhatsz a kezedből egy Állatot.”
  „Megnézheted az ellenfeled kezében lévő egységeket.”
- A játékos dolgai birtokos alakban: „a kezed”, „a temetőd”, „a szövetségeseid”,
  „az ellenfeled”.

**A csatatér nem beszél.** A csatatérlap szabályt mond ki, személytelenül, harmadik
személyben: „Minden egység -1 erőt kap.” „Egység csak a középső oszlopba
kerülhet.” A játékost megszólíthatja („A temetődből is letehetsz egységeket.”),
de magáról soha nem mond semmit.

**A ráhelyezett lap rövid szövege** (ami az egységen fekvő varázslatról látszik)
arról az egységről szól, amelyiken fekszik, harmadik személyben: „Nem mozoghat.”
„+2 erőt kap, de nem mozoghat.”

## Szavak, amelyek mindig ugyanazt jelentik

| Szó | Jelentés |
|---|---|
| szövetséges | a saját egységed |
| ellenség | az ellenfeled egysége |
| ellenfeled | a másik játékos |
| egység | bármelyik oldal egysége |
| erő | amennyit az egység éppen ér |
| alaperő | a lapra nyomtatott szám |
| gyűrű | erő, amit az egység megtart a csata végéig |
| sebzés | jelölő az egységen; csak akkor számít, ha megöli |
| szomszédos | közös élű mező: mellette, előtte vagy mögötte |
| velem szemben | az ellenfél első sorában, ugyanabban az oszlopban |
| élharcos | az oszlopban legelöl álló egységed |

Ha a hatás megmarad akkor is, ha az oka megszűnik, **gyűrű**. Ha csak addig él,
amíg a feltétele, **erő**. A két szót nem cseréljük fel: „+2 gyűrűt kapok” és
„+2 erőt kapok” két különböző lap.

## Állandó fordulatok

- Sebzés: „2 sebzést kap.” Nem „2-t sebződik” — a rag minden számnál más lenne.
- Feltételes sebzés: „1 sebzést kap, de ha a hátsó sorban áll, 4-et.”
- Erő: „+1 erőt kap.” „-3 erőt kap.” „+1 gyűrűt kap.”
- Halál: „Megölök egy…” vagy „Meghal minden egység, akinek…”.
- Tartós varázslat: „Amíg rajta van ez a lap, …” vagy, ha a varázslón marad,
  „Amíg rajtam van ez a lap, …”.
- Számolás: „Minden sérült ellenség után +1 erőt kapok.”
- Húzás: „Húzz egy varázslatot!” A lap nem magyarázza el a kézkeretet; azt a
  szabályzat teszi (12.11).
- Keresés: „Válassz egy varázslatot a temetődből, és vedd a kezedbe!”

## Kulcsszavak

A képességet bevezető szó nagybetűs, kettősponttal, utána nagybetűs mondat:
„Belépő: Húzz egy egységet!” Ugyanígy a Mustra, a Diadal és a Vigasz.

A magában álló kulcsszó külön sorban áll, ponttal, és első előfordulásakor
zárójelben megmondja, mit tesz:

- „Távolsági (a hátsó sorból is beleszámítok).”
- „Testőr (ha az első sorban állok, a mögöttem állót az ellenfél nem célozhatja
  varázslattal).”
- „Falka (ugyanilyen lapra is letehetsz; az erőnk összeadódik).”
- „Mesteri.” — a varázslat első sorában, magyarázat nélkül; a két kört a
  szabályzat írja le.

## Amit kerülünk

- Szabályzatnyelv a lapon: „a kézkeretem 1-gyel nő a csata végéig, és rögtön
  húzol rá” helyett „Húzz egy varázslatot!”.
- Kötőjeles tagadás: „nem-Állat” helyett „kivéve az Állatokat”.
- Idegen helyesírás magyar szóban: Geomancia (nem Geománcia), Hidrairha (nem
  Hydrairha). A kitalált nevek — Explar, Enormorf, Lepumorf — maradnak, ahogy
  vannak.
- Fél mondat. Minden szöveg egész mondat, állítmánnyal és írásjellel a végén.
