/**
 * The single declaration of what every effect / static / location effect looks
 * like. Two consumers read it and nothing else:
 *
 *   1. `cards.ts` validates card data against it at load time.
 *   2. The in-app card editor renders its forms from it, no per-effect UI code.
 *
 * Adding a new kind is therefore exactly two edits, next to each other: a
 * `KindSpec` block here and a handler in `effects.ts` (or a case in `power.ts`
 * for a static). The editor picks it up for free, and no engine code branches on
 * a card id.
 *
 * The tables are deliberately small. Eighty-nine units, a hundred and two
 * spells and fifteen battlefields come out of sixteen statics, forty-two
 * effects and eighteen location effects, because the variation lives in the
 * parameters.
 */

export type FieldSpec =
  | { name: string; type: "number"; label: string; default: number; min?: number; max?: number; step?: number; help?: string }
  | { name: string; type: "text"; label: string; default: string; help?: string }
  | { name: string; type: "boolean"; label: string; default: boolean; help?: string }
  | { name: string; type: "select"; label: string; default: string; options: string[]; help?: string }
  | { name: string; type: "cardRef"; label: string; default: string; cardKind: "unit" | "spell"; help?: string }
  | { name: string; type: "attachmentRef"; label: string; default: string; help?: string }
  | { name: string; type: "school"; label: string; default: string; help?: string }
  | { name: string; type: "keyword"; label: string; default: string; help?: string };

export interface KindSpec {
  kind: string;
  label: string;
  /** One sentence, shown in the editor's picker. */
  summary: string;
  fields: FieldSpec[];
  /** Effects that resolve without the caster nominating a unit (AoE and self). */
  selfTargeting?: boolean;
  /** Effects that need an extra destination pick from the player. */
  needsDestination?: boolean;
  /** Effects that need a card picked out of the caster's hand. */
  needsHandCard?: boolean;
}

const ON_FIELD: FieldSpec = {
  name: "on",
  type: "select",
  label: "Kire hat",
  default: "target",
  options: ["target", "caster"],
  help: "Melyik egységre száll a hatás, miután a célzás eldőlt.",
};

/**
 * One condition list serves `powerBonus` and `selfGrant`. Every "+X, ha …"
 * egység a készletben ebből a felsorolásból választ.
 */
export const STATIC_CONDITIONS = [
  "always",
  "frontRow",
  "backRow",
  "enemyHalf",
  "noHidden",
  "opposedOccupied",
  "opposedEmpty",
  "opposedWeaker",
  "opposedStronger",
  "isolated",
  "isolatedDiagonal",
  "aloneInRow",
  "aloneInFrontRow",
  "aloneOnBoard",
  "immobile",
  "graveyardAtLeast",
  "noPlacedOnMe",
] as const;

const CONDITION_FIELD: FieldSpec = {
  name: "condition",
  type: "select",
  label: "Feltétel",
  default: "always",
  options: [...STATIC_CONDITIONS],
  help:
    "opposedWeaker / opposedStronger a nyomtatott erőt hasonlítja, így sosem hívja vissza a power() számítást.",
};

/** Where a static looks when it counts or hands out power. */
const SCOPE_OPTIONS = ["self", "adjacent", "diagonal", "board", "row", "column", "columnFront"];

// ---------------------------------------------------------------------------
// Static abilities
// ---------------------------------------------------------------------------

export const STATIC_SPECS: KindSpec[] = [
  {
    kind: "powerBonus",
    label: "Feltételes erőbónusz",
    summary:
      "+X, amíg a feltétel áll. Ez az összes „+X, ha …” egység: Ninja, Medve, Guner, Vérfarkas, Cassanus.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
      CONDITION_FIELD,
      {
        name: "value",
        type: "number",
        label: "Küszöb (csak graveyardAtLeast)",
        default: 0,
        min: 0,
        help: "A graveyardAtLeast feltételhez: ennyi lap kell a temetőbe.",
      },
    ],
  },
  {
    kind: "countBonus",
    label: "Létszámbónusz",
    summary:
      "+X minden illeszkedő egység után a megadott körzetben, vagy fix +X, ha eléri a küszöböt.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
      { name: "side", type: "select", label: "Oldal", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "scope", type: "select", label: "Körzet", default: "board", options: SCOPE_OPTIONS },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavú egység", default: "" },
      {
        name: "requires",
        type: "select",
        label: "További szűrő",
        default: "any",
        options: ["any", "damaged", "hidden", "placed"],
      },
      {
        name: "atLeast",
        type: "number",
        label: "Küszöb (0 = darabonként)",
        default: 0,
        min: 0,
        help: "0 fölött a bónusz nem darabonként jár, hanem egyszer, ha a létszám eléri ezt.",
      },
    ],
  },
  {
    kind: "aura",
    label: "Aura: erőt ad másoknak",
    summary: "+X-et ad a körzetében álló egységeknek. Kovács, Altus, Maffiavezér, Simorf.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
      { name: "side", type: "select", label: "Kiknek", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "scope", type: "select", label: "Körzet", default: "adjacent", options: SCOPE_OPTIONS },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavúaknak", default: "" },
      { ...CONDITION_FIELD, label: "Csak amíg rám igaz" },
      {
        name: "maxBasePower",
        type: "number",
        label: "Csak legfeljebb ekkora alaperejűnek (0 = nincs szűrés)",
        default: 0,
        min: 0,
      },
      {
        name: "atLeastCount",
        type: "number",
        label: "Csak ekkora létszám fölött (0 = mindig)",
        default: 0,
        min: 0,
      },
      {
        name: "includeSelf",
        type: "boolean",
        label: "Magára is hat",
        default: false,
      },
    ],
  },
  {
    kind: "auraGrant",
    label: "Aura: tulajdonságot ad másoknak",
    summary: "Célozhatatlanságot, sérthetetlenséget vagy kulcsszót ad a körzetének. Kém, Bol'Jin, Fehér Pásztor.",
    fields: [
      { name: "side", type: "select", label: "Kiknek", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "scope", type: "select", label: "Körzet", default: "adjacent", options: SCOPE_OPTIONS },
      {
        name: "grant",
        type: "select",
        label: "Mit ad",
        default: "untargetable",
        options: ["untargetable", "invulnerable", "cannotDie", "keyword"],
      },
      { name: "keyword", type: "keyword", label: "Kulcsszó (grant=keyword esetén)", default: "" },
      {
        name: "cardId",
        type: "cardRef",
        label: "Csak erre a lapra",
        default: "",
        cardKind: "unit",
        help: "A Kém csak a Maffiavezért védi.",
      },
    ],
  },
  {
    kind: "selfGrant",
    label: "Saját tulajdonság",
    summary: "Sérthetetlen, célozhatatlan, nem rejthető, varázslatra immunis, akár feltételhez kötve.",
    fields: [
      {
        name: "grant",
        type: "select",
        label: "Mit kap",
        default: "invulnerable",
        options: ["invulnerable", "untargetable", "cannotDie", "cannotHide", "spellImmune"],
      },
      CONDITION_FIELD,
      { name: "value", type: "number", label: "Küszöb (csak graveyardAtLeast)", default: 0, min: 0 },
    ],
  },
  {
    kind: "powerFloor",
    label: "Erőpadló",
    summary: "A körzet egységeinek ereje nem eshet az alaperejük alá. Ez a Faun.",
    fields: [
      { name: "side", type: "select", label: "Kiknek", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "scope", type: "select", label: "Körzet", default: "board", options: SCOPE_OPTIONS },
    ],
  },
  {
    kind: "redirectSpells",
    label: "Varázslatterelés",
    summary: "A körzetére szálló varázslat őrá kerül helyette. Ez a Dionzosz.",
    fields: [
      { name: "side", type: "select", label: "Kiket véd", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "scope", type: "select", label: "Körzet", default: "adjacent", options: SCOPE_OPTIONS },
    ],
  },
  {
    kind: "suppressOpposed",
    label: "Szemközti képesség kioltása",
    summary: "A vele szemben álló egység képességei nem aktívak. Ez a Vérfarkas második fele.",
    fields: [
      {
        name: "condition",
        type: "select",
        label: "Mikor",
        default: "opposedWeaker",
        options: ["always", "opposedWeaker", "opposedStronger"],
      },
    ],
  },
  {
    kind: "spellMod",
    label: "Varázslatmódosító",
    summary: "A tulajdonos varázslatainak költségét vagy sebzését tolja el. Explodus, Erif mester.",
    fields: [
      { name: "what", type: "select", label: "Mit módosít", default: "cost", options: ["cost", "damage"] },
      { name: "amount", type: "number", label: "Mennyiség", default: -1, step: 1 },
      { name: "tag", type: "text", label: "Csak ilyen címkéjű varázslat", default: "Tűzmágia" },
      { name: "school", type: "school", label: "Csak ilyen iskolájú varázslat", default: "" },
    ],
  },
  {
    kind: "freeCasts",
    label: "Ingyenes varázslás",
    summary: "Ennyi varázslatot költség nélkül elsüthet. Ez A Moirák.",
    fields: [{ name: "count", type: "number", label: "Hány darab", default: 3, min: 1 }],
  },
  {
    kind: "banCasting",
    label: "Varázslás betiltása",
    summary: "Amíg a táblán van, senki nem játszhat ki varázslatot. Ez az Omen.",
    fields: [],
  },
  {
    kind: "placementRule",
    label: "Lerakási megkötés",
    summary: "Csak ilyen kulcsszavú szövetségessel szomszédos mezőre játszható ki. Ez a Papagáj.",
    fields: [{ name: "requireAdjacentKeyword", type: "keyword", label: "Kulcsszó", default: "Kalóz" }],
  },
  {
    kind: "selfRestrict",
    label: "Korlátozás",
    summary: "Nem mozoghat, nem varázsolhat, vagy nincs képessége. A ráakasztott lapok használják.",
    fields: [
      {
        name: "restrict",
        type: "select",
        label: "Mi tiltott",
        default: "move",
        options: ["move", "cast", "abilities"],
      },
    ],
  },
  {
    kind: "damageCap",
    label: "Sebzésplafon",
    summary:
      "A körzet egységei egyetlen hatástól sem szenvedhetnek el ennél több sebzést. Ez A Faarcú.",
    fields: [
      { name: "amount", type: "number", label: "Legfeljebb ennyi sebzés", default: 2, min: 0 },
      { name: "side", type: "select", label: "Kiket véd", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "scope", type: "select", label: "Körzet", default: "board", options: SCOPE_OPTIONS },
    ],
  },
  {
    kind: "castRing",
    label: "Gyűrű a megcélzottnak",
    summary:
      "Amikor ez az egység varázslattal megcéloz egy illeszkedő egységet, a célpont gyűrűt kap. Ez az Elfina.",
    fields: [
      { name: "amount", type: "number", label: "Gyűrű", default: 1, step: 1 },
      { name: "side", type: "select", label: "Kire", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavúra", default: "Állat" },
    ],
  },
  {
    kind: "powerOverride",
    label: "Erő felülírása",
    summary: "Az alaperőre állítja vissza, vagy fix értéket ad. Természetes forma, Enormorf.",
    fields: [
      { name: "mode", type: "select", label: "Mód", default: "base", options: ["base", "fixed"] },
      { name: "value", type: "number", label: "Fix érték", default: 6, min: 0 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export const EFFECT_SPECS: KindSpec[] = [
  {
    kind: "modifyPower",
    label: "Erő módosítása",
    summary: "Hozzáad vagy levon erőt. A sebzéssel ellentétben mindig elmozdítja az összehasonlítást.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: -1, step: 1 }, ON_FIELD],
  },
  {
    kind: "grantRing",
    label: "Gyűrű adása",
    summary:
      "Végleges erő, amit egy már bekövetkezett feltétel adott. Megmarad akkor is, ha az adományozó lekerül a tábláról. ⊙ jellel látszik.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
      {
        name: "per",
        type: "select",
        label: "Mennyiért jár",
        default: "once",
        options: ["once", "keyword", "graveyard", "targets"],
        help:
          "A 'keyword' a táblán álló illeszkedő szövetségeseket számolja (Falkavezér), a 'graveyard' a temető lapjait, `perCount`-onként (Csontvért). A 'targets' azt, hány célpontja lett a képességnek — ezzel a gyűrű az ára valaminek: nincs célpont, nincs gyűrű. Ez az Azman.",
      },
      { name: "keyword", type: "keyword", label: "Kulcsszó (per=keyword)", default: "" },
      {
        name: "perCount",
        type: "number",
        label: "Hány laponként (per=graveyard)",
        default: 1,
        min: 1,
      },
      { name: "max", type: "number", label: "Legfeljebb ennyi gyűrű (0 = nincs plafon)", default: 0, min: 0 },
      {
        name: "alsoCopies",
        type: "boolean",
        label: "A célpont minden szövetséges másolata is megkapja",
        default: false,
        help: "Ez a Csatacsorda: ugyanaz a lap a táblán bárhányszor.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "setPower",
    label: "Erő beállítása",
    summary: "Felülírja a nyomtatott értéket ahelyett, hogy módosítaná, így nincs halmozódási számolgatás.",
    fields: [{ name: "value", type: "number", label: "Új erő", default: 6, min: 0 }, ON_FIELD],
  },
  {
    kind: "damage",
    label: "Sebzésjelölő",
    summary:
      "Maradandó −X jelölő, ami az összesítésbe nem számít bele, de a 0 elérése öl. A mennyiség fix, feltételes vagy a varázsló erejéből származtatott.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 2, min: 0 },
      {
        name: "altAmount",
        type: "number",
        label: "Másik mennyiség, ha a feltétel áll",
        default: 0,
        min: 0,
        help: "A Hátbaszúrás 2-t sebez, a hátsó sorban 4-et.",
      },
      {
        name: "altIf",
        type: "select",
        label: "Ehhez a feltétel",
        default: "always",
        options: [...STATIC_CONDITIONS],
        help: "A megcélzott egységre nézve. Az 'always' azt jelenti, hogy nincs második mennyiség.",
      },
      {
        name: "casterPowerDiv",
        type: "number",
        label: "A varázsló erejének ennyiedrésze (0 = fix mennyiség)",
        default: 0,
        min: 0,
        help: "Az Eltaposás 1-et ír ide: a varázsló teljes ereje.",
      },
      {
        name: "source",
        type: "select",
        label: "Honnan jön a mennyiség",
        default: "flat",
        options: ["flat", "load", "powerGap"],
        help:
          "A 'load' a célponton fekvő lapokat számolja: minden ráhelyezett varázslat, minden sebzésjelölő és minden gyűrű egy sebzés. Ez a Lélektűz. A 'powerGap' az, amennyivel a varázsló erősebb a célpontnál — ez az Eltaposás, és a célzásnál a weakerThanCaster szűrő tartozik hozzá.",
      },
      {
        name: "minimum",
        type: "number",
        label: "Alsó határ",
        default: 0,
        min: 0,
        help:
          "A kiszámolt mennyiség sosem lehet ennél kevesebb. Az Eltaposás 3-at ír ide: két egyforma erejű egység között is fáj.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "destroy",
    label: "Megsemmisítés",
    summary:
      "Az egység azonnal lekerül a mezőjéről. Az Óriásölő, a Fojtás, a Rajtaütés és a Kegyelemdöfés mind ez, csak a célzószűrőjük más.",
    fields: [ON_FIELD],
  },
  {
    kind: "massDestroy",
    label: "Tömeges pusztítás",
    summary: "Küszöb szerint söpri le a táblát. Káoszkolera, Homályhimlő, Valóságtörés, Umbradog.",
    selfTargeting: true,
    fields: [
      { name: "side", type: "select", label: "Oldal", default: "all", options: ["enemy", "ally", "all"] },
      { name: "stat", type: "select", label: "Vizsgált érték", default: "basePower", options: ["power", "basePower"] },
      {
        name: "atMost",
        type: "number",
        label: "Legfeljebb ennyi (−1 = mindenki)",
        default: 2,
        min: -1,
        step: 1,
      },
      {
        name: "requires",
        type: "select",
        label: "További szűrő",
        default: "any",
        options: ["any", "damaged", "placed"],
      },
      { name: "excludeSelf", type: "boolean", label: "A varázslót kihagyja", default: true },
    ],
  },
  {
    kind: "move",
    label: "Mozgatás",
    summary: "Áthelyez egy egységet. Célmezőt kell választani hozzá.",
    needsDestination: true,
    fields: [
      {
        name: "destination",
        type: "select",
        label: "Célmező",
        default: "adjacent",
        options: ["adjacent", "diagonal", "anyEmpty"],
        help:
          "Az 'adjacent' szomszédos (élben érintkező) üres mezőt jelent, a 'diagonal' átlósan érintkezőt (Becsusszanás). Az érkezési mező a 8.4.5 szerint bármelyik térfélen lehet, ezt nem kell külön megengedni.",
      },
      {
        name: "optional",
        type: "boolean",
        label: "Nem kötelező lépni",
        default: false,
        help: "A Kitörés csak mozoghat: a saját mezője is választható célmező, és ez a nemet.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "swapWithAdjacent",
    label: "Két szomszédos egység cseréje",
    summary:
      "A megcélzott egység helyet cserél egy vele szomszédos egységgel. Összjáték (szövetségessel), Testcsel (ellenséggel).",
    needsDestination: true,
    fields: [
      {
        name: "side",
        type: "select",
        label: "Kivel cserélhet",
        default: "ally",
        options: ["ally", "enemy", "any"],
      },
    ],
  },
  {
    kind: "advance",
    label: "Előrenyomulás",
    summary: "Amíg üres mező van előtte az oszlopában, előrelép, és minden megtett mezőért gyűrűt kap.",
    selfTargeting: true,
    fields: [{ name: "ringPerTile", type: "number", label: "Gyűrű mezőnként", default: 1, step: 1 }],
  },
  {
    kind: "transform",
    label: "Átváltoztatás",
    summary: "Az egységet egy másik lapra cseréli, a mezőn maradva.",
    fields: [
      { name: "into", type: "cardRef", label: "Mivé válik", default: "nyul", cardKind: "unit" },
      {
        name: "keepAbilities",
        type: "boolean",
        label: "Képességek és varázserő megmaradnak",
        default: false,
      },
      ON_FIELD,
    ],
  },
  {
    kind: "attach",
    label: "Lap ráakasztása",
    summary: "Ráakaszt egy lapot az egységre. A lap levétele megszünteti a hatást.",
    fields: [
      { name: "attachment", type: "attachmentRef", label: "Ráakasztott lap", default: "acelpenge" },
      ON_FIELD,
    ],
  },
  {
    kind: "clearPlaced",
    label: "Ráakasztott lapok levétele",
    summary: "Leszedi a ráhelyezett varázslatokat. Vedlés, Tisztítás, Napéjegyenlőség.",
    fields: [
      {
        name: "count",
        type: "number",
        label: "Hány lapot (0 = mindet)",
        default: 0,
        min: 0,
      },
      {
        name: "everyUnit",
        type: "boolean",
        label: "A tábla minden egységéről",
        default: false,
        help: "A Napéjegyenlőség söpri le az egész táblát; a Vedlés csak a varázslót.",
      },
      {
        name: "only",
        type: "select",
        label: "Melyik lapokat",
        default: "any",
        options: ["any", "damage", "spell"],
        help:
          "A 'damage' csak a sebzésjelölőket veszi le, a legnagyobbal kezdve (Gyógyfüvek); a 'spell' csak a ráakasztott varázslatokat.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "grantImmunity",
    label: "Immunitás adása",
    summary: "Az egységet nem célozhatja többé az adott címkéjű vagy iskolájú varázslat.",
    fields: [{ name: "school", type: "school", label: "Iskola vagy címke", default: "Tűzmágia" }, ON_FIELD],
  },
  {
    kind: "fizzleShield",
    label: "Álomfogó-pajzs",
    summary: "A következő rá irányuló varázslat elszáll, akármennyibe került.",
    fields: [
      {
        name: "maxCost",
        type: "number",
        label: "Költséghatár (0 = nincs határ)",
        default: 0,
        min: 0,
        help: "Az Álomfogó és az Omnifex 0-t ír ide: a következő varázslat elszáll, bármi is az.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "lock",
    label: "Befagyasztás",
    summary: "Célozhatatlan, nem varázsolhat, az ereje rögzített. Ez a Jéghegy.",
    fields: [{ name: "power", type: "number", label: "Rögzített erő", default: 1, min: 0 }, ON_FIELD],
  },
  {
    kind: "duel",
    label: "Párbaj",
    summary: "A varázsló és a cél összeméri az erejét: az erősebb megöli a gyengébbet.",
    fields: [],
  },
  {
    kind: "devour",
    label: "Felfalás",
    summary:
      "Ha a körzetében álló, nála gyengébb egységek összereje eléri a küszöböt, mindet elpusztítja és gyűrűt kap értük.",
    selfTargeting: true,
    fields: [
      { name: "scope", type: "select", label: "Körzet", default: "diagonal", options: SCOPE_OPTIONS },
      { name: "minTotalPower", type: "number", label: "Összerő-küszöb", default: 8, min: 1 },
      { name: "gain", type: "number", label: "Gyűrű", default: 8, step: 1 },
    ],
  },
  {
    kind: "modifySpellpower",
    label: "Varázserő csökkentése",
    summary: "Elvesz a cél varázserő-készletéből, minden iskolájából. Ez a Mágiacenzor.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: 2, min: 1 }, ON_FIELD],
  },
  {
    kind: "revealHidden",
    label: "Rejtett egység felfedése",
    summary: "Lapjával felfelé fordít egy lefordított ellenséget, és elsüti a Belépőjét.",
    selfTargeting: true,
    fields: [{ name: "count", type: "number", label: "Hány darabot", default: 1, min: 1 }],
  },
  {
    kind: "summon",
    label: "Idézés a kézből",
    summary: "A kézből tesz egy egységet a megcélzott üres mezőre.",
    needsHandCard: true,
    fields: [
      { name: "ignoreCap", type: "boolean", label: "Figyelmen kívül hagyja a keretet", default: false },
      { name: "maxCost", type: "number", label: "Legfeljebb ekkora költségű (0 = bármi)", default: 0, min: 0 },
    ],
  },
  {
    kind: "thresholdAoe",
    label: "Küszöbös területhatás",
    summary:
      "A táblát egyetlen halmazként olvassa: minden legfeljebb X értékű egységet elér. Sosem elosztott sebzés.",
    selfTargeting: true,
    fields: [
      { name: "stat", type: "select", label: "Vizsgált érték", default: "power", options: ["power", "basePower"] },
      { name: "atMost", type: "number", label: "Legfeljebb ennyi", default: 3, min: 0 },
      { name: "amount", type: "number", label: "Erőváltozás", default: -2, step: 1 },
      { name: "side", type: "select", label: "Oldal", default: "enemy", options: ["enemy", "ally", "all"] },
    ],
  },

  // -------------------------------------------------------------------------
  // Card economy
  // -------------------------------------------------------------------------
  {
    kind: "draw",
    label: "Húzás",
    summary: "Lapot húz a pakli tetejéről.",
    selfTargeting: true,
    fields: [
      { name: "cardKind", type: "select", label: "Miből", default: "spell", options: ["spell", "unit"] },
      { name: "count", type: "number", label: "Hány lap", default: 1, min: 1 },
      { name: "who", type: "select", label: "Ki húz", default: "self", options: ["self", "opponent", "both"] },
    ],
  },
  {
    kind: "drawNextLocation",
    label: "Húzás a következő csata előtt",
    summary: "Extra lapot ír jóvá a következő feltöltéskor. Ez a Diadal.",
    selfTargeting: true,
    fields: [
      { name: "cardKind", type: "select", label: "Miből", default: "unit", options: ["spell", "unit"] },
      { name: "count", type: "number", label: "Hány lap", default: 1, min: 1 },
    ],
  },
  {
    kind: "discard",
    label: "Eldobás",
    summary: "Lapot dob el a kézből, akár gyűrűért cserébe. Chupacabra, Vadász, Varjú, Umbradog.",
    selfTargeting: true,
    fields: [
      { name: "cardKind", type: "select", label: "Miből", default: "unit", options: ["spell", "unit", "both"] },
      { name: "count", type: "number", label: "Hány lap (−1 = az egész kéz)", default: 1, step: 1 },
      { name: "who", type: "select", label: "Ki dob", default: "self", options: ["self", "opponent", "both"] },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavút", default: "" },
      {
        name: "ringPer",
        type: "number",
        label: "Gyűrű eldobott laponként",
        default: 0,
        step: 1,
        help: "A Vadász 2-t kap egyért, a Varjú 1-et minden eldobottért.",
      },
      {
        name: "choose",
        type: "boolean",
        label: "A játékos választja ki",
        default: false,
        help:
          "Bekapcsolva a lap megkérdezi, mit dobjon el, ahelyett hogy a legolcsóbbat venné. A Chupacabra ezt írja be. Csak a saját kezére működik: az ellenfél kezéből dobatni továbbra is a legolcsóbbat viszi.",
      },
      { name: "optional", type: "boolean", label: "Nem kötelező", default: false },
    ],
  },
  {
    kind: "searchDeck",
    label: "Kikeresés",
    summary:
      "Kilistázza a paklit vagy a temetőt, a játékos választ, a választott lap a kézbe kerül.",
    selfTargeting: true,
    fields: [
      { name: "cardKind", type: "select", label: "Miből", default: "spell", options: ["spell", "unit"] },
      { name: "source", type: "select", label: "Honnan", default: "deck", options: ["deck", "graveyard"] },
      { name: "count", type: "number", label: "Hány lap", default: 1, min: 1 },
      { name: "maxPower", type: "number", label: "Legfeljebb ekkora erő (0 = bármi)", default: 0, min: 0 },
      { name: "excludeRarity", type: "text", label: "Ezt a ritkaságot kihagyja", default: "" },
      { name: "who", type: "select", label: "Ki keres", default: "self", options: ["self", "both"] },
    ],
  },
  {
    kind: "revive",
    label: "Feltámasztás",
    summary: "A temetőből idéz egységet üres mezőre. Feltámadás, Nyirokhold.",
    selfTargeting: true,
    fields: [
      { name: "count", type: "number", label: "Hány egység", default: 1, min: 1 },
      { name: "maxPower", type: "number", label: "Legfeljebb ekkora alaperő", default: 3, min: 0 },
      { name: "ignoreCap", type: "boolean", label: "Nem számít a keretbe", default: true },
    ],
  },
  {
    kind: "returnToHand",
    label: "Kézbe vétel",
    summary: "Az egység a mezőről a kézbe kerül. Csábítás, Makacs élőhalott.",
    fields: [
      {
        name: "toOwner",
        type: "select",
        label: "Kinek a kezébe",
        default: "owner",
        options: ["owner", "caster"],
        help: "A Csábítás a varázslóéba, a Vigasz a sajátjáéba.",
      },
      {
        name: "afterLocation",
        type: "boolean",
        label: "Csak a csata után",
        default: false,
        help: "A Csábítás a csata végéig a táblán hagyja az egységet.",
      },
      ON_FIELD,
    ],
  },
  {
    kind: "stealCard",
    label: "Laplopás",
    summary: "Az ellenfél paklijának tetejéről vagy a kezéből vesz el lapot. Rabló, Zsebmetszés.",
    selfTargeting: true,
    fields: [
      { name: "from", type: "select", label: "Honnan", default: "deckTop", options: ["deckTop", "hand"] },
      { name: "cardKind", type: "select", label: "Miből", default: "unit", options: ["spell", "unit"] },
      { name: "count", type: "number", label: "Hány lap", default: 1, min: 1 },
    ],
  },
  {
    kind: "bounceToDeckBottom",
    label: "Visszaküldés a pakli aljára",
    summary: "A legutoljára kijátszott egységet visszateszi a tulajdonosa paklijának aljára. Ez a Kirkar.",
    selfTargeting: true,
    fields: [
      { name: "side", type: "select", label: "Kiét", default: "any", options: ["enemy", "ally", "any"] },
    ],
  },
  {
    kind: "swapHandGraveyard",
    label: "Kéz és temető cseréje",
    summary: "A kéz és a temető helyet cserél. Ez a Welsing.",
    selfTargeting: true,
    fields: [
      { name: "cardKind", type: "select", label: "Miből", default: "unit", options: ["spell", "unit", "both"] },
    ],
  },
  {
    kind: "coinFlip",
    label: "Érmedobás",
    summary:
      "Unikornis: gyűrűt kap, és megkérdezi, dobjon-e újra. Írás: minden addig kapott gyűrűjét elveszti. Ez a Szerencsejátékos.",
    selfTargeting: true,
    fields: [
      { name: "amount", type: "number", label: "Gyűrű nyerés esetén", default: 1, step: 1 },
      {
        name: "reflips",
        type: "number",
        label: "Hányszor dobhat még újra",
        default: 1,
        min: 0,
        help:
          "Minden újradobás megduplázza a tétet, de bukás esetén mindent visz. Az újradobás nem automatikus: a játékos dönt róla.",
      },
    ],
  },
  {
    kind: "peek",
    label: "Betekintés",
    summary:
      "Megnézhető a kéz, a varázslatkéz vagy a következő csatatér. A látottat csak a betekintő játékos kapja meg.",
    selfTargeting: true,
    fields: [
      {
        name: "what",
        type: "select",
        label: "Mit",
        default: "spellHand",
        options: ["hand", "spellHand", "nextLocation"],
      },
      {
        name: "ringIfCostlier",
        type: "number",
        label: "Gyűrű, ha a felfedett lap drágább nálam",
        default: 0,
        min: 0,
        help:
          "Nem nullánál egyetlen véletlen lap fordul ki, nem az egész kéz. A Fejvadász így fizeti ki magát belőle.",
      },
    ],
  },
  {
    kind: "handSwap",
    label: "Kézcsere",
    summary:
      "Elhúz legfeljebb N egységlapot az ellenfél kezéből, majd ugyanennyit visszaad a sajátjából. Ez a Griff. Mindkét fele kérdés, nem a motor dönti el.",
    selfTargeting: true,
    fields: [
      { name: "count", type: "number", label: "Legfeljebb hány lap", default: 3, min: 1 },
    ],
  },
  {
    kind: "setTrap",
    label: "Csapda lehelyezés",
    summary:
      "Egy varázslat a kézből lapjával lefelé egy üres ellenséges mezőre. Aki rálép — bárki, szövetséges is —, arra sül el. Ez a Fuedrax.",
    selfTargeting: true,
    fields: [],
  },
  {
    kind: "portal",
    label: "Portál a következő csatatérre",
    summary:
      "Az egység a következő csatatéren ugyanarra a mezőre érkezik, tisztán és a költségkereten kívül. Ez a Felix Vigasza.",
    fields: [ON_FIELD],
  },
  {
    kind: "stealRing",
    label: "Gyűrűlopás",
    summary:
      "Levesz a célpontról ennyi gyűrűt, és a varázslóra teszi. Sosem hoz létre gyűrűt a semmiből: amennyi nincs a célponton, annyi nem is kerül át. Ez az Elcsenés.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: 1, min: 1 }],
  },
  {
    kind: "massRing",
    label: "Gyűrű mindenkinek",
    summary:
      "Egy oldal minden egysége kap egy gyűrűt. Ez az egyetlen megengedett többcélpontos erőhatás: a gyűrű egyszer lekerül a lapra és soha többé nem kell újraszámolni. Ez a Kivirágzás.",
    selfTargeting: true,
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
      { name: "side", type: "select", label: "Kiknek", default: "ally", options: ["ally", "enemy", "all"] },
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavúaknak", default: "" },
    ],
  },
  {
    kind: "moveAttachment",
    label: "Ráakasztott lap áthelyezése",
    summary:
      "Egy ráhelyezett lapot átrak a varázslóról a megnevezett szomszédos egységre. Ez a Transzfúzió: az áldás és az átok ugyanazon az úton jár.",
    needsDestination: true,
    fields: [
      {
        name: "only",
        type: "select",
        label: "Melyik lapot",
        default: "any",
        options: ["any", "damage", "spell"],
      },
    ],
  },
  {
    kind: "sacrificeStrike",
    label: "Feláldozás csapásért",
    summary:
      "Megöli a megcélzott szövetségest, és az erejével egyenlő sebzést tesz egy vele szomszédos ellenségre. Ez a Megtorlás.",
    needsDestination: true,
    fields: [],
  },
  {
    kind: "forceAttack",
    label: "Kényszerített csapás",
    summary:
      "A megcélzott egység a saját erejével egyenlő sebzést tesz egy vele szomszédos szövetségesére. Ez az Elmezavar.",
    needsDestination: true,
    fields: [],
  },
  {
    kind: "transformFromHand",
    label: "Átváltozás kézből",
    summary:
      "Az egység lekerül, és a helyére a kézből érkezik egy másik, a keret és a lerakási sorrend megkerülésével. Metamorfózis, Monstrosis.",
    needsHandCard: true,
    fields: [
      { name: "keyword", type: "keyword", label: "Csak ilyen kulcsszavú lap", default: "Állat" },
      { name: "maxCost", type: "number", label: "Legfeljebb ekkora költségű", default: 5, min: 0 },
      ON_FIELD,
    ],
  },
  {
    kind: "note",
    label: "Jegyzet (nincs mechanika)",
    summary:
      "A lap létezik és a szövege olvasható, de a motor jelenleg nem gépesíti. Csak a krónikába ír.",
    selfTargeting: true,
    fields: [{ name: "text", type: "text", label: "Szöveg", default: "" }],
  },
];

// ---------------------------------------------------------------------------
// Location effects
// ---------------------------------------------------------------------------

export const LOCATION_EFFECT_SPECS: KindSpec[] = [
  {
    kind: "flatBonus",
    label: "Fix bónusz",
    summary: "+X minden itt álló egységnek, amíg a csatatéren áll. Kesergő.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 }],
  },
  {
    kind: "entryRing",
    label: "Gyűrű belépéskor",
    summary:
      "Minden egység gyűrűt kap, ahogy a csatatérre lép. A fix bónusszal ellentétben ez az egységé marad: a 9.4 szerint elvehetetlen, és a lapon is látszik. Oppidium.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 }],
  },
  {
    kind: "keywordBonus",
    label: "Kulcsszóbónusz",
    summary: "+X az adott kulcsszót viselő egységeknek, akár sorra szűkítve, akár megfordítva.",
    fields: [
      { name: "keyword", type: "keyword", label: "Kulcsszó", default: "Állat" },
      { name: "amount", type: "number", label: "Mennyiség", default: 2, step: 1 },
      { name: "row", type: "select", label: "Csak ebben a sorban", default: "", options: ["", "F", "B"] },
      {
        name: "invert",
        type: "boolean",
        label: "Épp azokra hat, akiken NINCS rajta",
        default: false,
        help: "Az Akáczos így bünteti a nem-Állat egységeket az első sorban.",
      },
    ],
  },
  {
    kind: "strongestPenalty",
    label: "A legerősebb bünteti",
    summary: "A csatatér legerősebb egysége −X-et kap. Azonos erő esetén mindegyikük. Ez a Sikátor.",
    fields: [{ name: "amount", type: "number", label: "Mennyiség", default: -1, step: 1 }],
  },
  {
    kind: "perCost",
    label: "Költségarányos bónusz",
    summary: "+mennyiség minden „ennyi” pont nyomtatott költség után. A drága egységek felé billent.",
    fields: [
      { name: "per", type: "number", label: "Ennyi költségenként", default: 3, min: 1 },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "costAtMostBonus",
    label: "Olcsó egység bónusza",
    summary: "+X a legfeljebb ekkora költségű egységeknek. A nyüzsgés felé billent.",
    fields: [
      { name: "maxCost", type: "number", label: "Legfeljebb ekkora költség", default: 1, min: 0 },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "rowBonus",
    label: "Sorbónusz",
    summary: "+X az egyik sorban álló egységeknek.",
    fields: [
      { name: "row", type: "select", label: "Sor", default: "F", options: ["F", "B"] },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, step: 1 },
    ],
  },
  {
    kind: "schoolSpellpowerBonus",
    label: "Varázserő-bónusz",
    summary: "+X varázserő abból az iskolából minden itt álló egységnek, amelyik már csatornázza.",
    fields: [
      { name: "school", type: "school", label: "Iskola", default: "Mágus" },
      { name: "amount", type: "number", label: "Mennyiség", default: 1, min: 1 },
    ],
  },
  {
    kind: "costMod",
    label: "Költségkedvezmény",
    summary: "Az adott kulcsszavú egységek kevesebb keretet fogyasztanak. Ez a Kikötő.",
    fields: [
      { name: "keyword", type: "keyword", label: "Kulcsszó", default: "Kalóz" },
      { name: "amount", type: "number", label: "Mennyiség", default: -1, step: 1 },
      { name: "min", type: "number", label: "Legalább ennyibe kerüljön", default: 0, min: 0 },
    ],
  },
  {
    kind: "spellCostMod",
    label: "Varázslat-kedvezmény",
    summary: "Minden varázslat ennyivel kevesebbe kerül. Ez a Máguskör.",
    fields: [
      { name: "amount", type: "number", label: "Mennyiség", default: -1, step: 1 },
      { name: "min", type: "number", label: "Legalább ennyibe kerüljön", default: 1, min: 0 },
    ],
  },
  {
    kind: "rangeCap",
    label: "Hatótáv-korlát",
    summary: "Egyetlen varázslat hatótávja sem lehet ennél nagyobb. Ez a Ködrét.",
    fields: [{ name: "max", type: "number", label: "Legfeljebb", default: 1, min: 0 }],
  },
  {
    kind: "suppressPositional",
    label: "Pozíciós bónusz kioltása",
    summary: "Az adott kulcsszó sor-bónusza itt nem érvényesül. A Ködrét a Távolságit oltja ki.",
    fields: [{ name: "keyword", type: "keyword", label: "Kulcsszó", default: "Távolsági" }],
  },
  {
    kind: "autoHide",
    label: "Automatikus rejtés",
    summary: "Az itt lerakott egységek lefordítva érkeznek, fizetség nélkül. Feketepiac, Ködrét.",
    fields: [
      {
        name: "keyword",
        type: "keyword",
        label: "Csak ilyen kulcsszavúak (üres = mindenki)",
        default: "",
      },
    ],
  },
  {
    kind: "hideCostMod",
    label: "Rejtés ára",
    summary: "Ennyi egységlapba kerül egy egység elrejtése. Ez a Feketepiac.",
    fields: [
      { name: "cost", type: "number", label: "Eldobandó lapok száma", default: 2, min: 1 },
      { name: "exceptKeyword", type: "keyword", label: "Kivéve az ilyen kulcsszavúak", default: "" },
    ],
  },
  {
    kind: "blockedSlots",
    label: "Járhatatlan mezők",
    summary: "Ezekre a mezőkre nem kerülhet egység. Ez A Pék hídja szakadéka.",
    fields: [
      {
        name: "slots",
        type: "text",
        label: "Mezők (vesszővel, pl. F1,F3)",
        default: "F1,F3",
        help: "Mindkét játékos oldalán ugyanazok a mezők zárulnak be.",
      },
    ],
  },
  {
    kind: "salvage",
    label: "Leszereléskor megmenekül",
    summary:
      "A csata végén az ilyen kulcsszavú egységek nem a temetőbe kerülnek. Ez a Plázs.",
    fields: [
      { name: "keyword", type: "keyword", label: "Kulcsszó (üres = mindenki)", default: "Felindori" },
      {
        name: "to",
        type: "select",
        label: "Hova kerül helyette",
        default: "deckBottom",
        options: ["deckBottom", "hand"],
      },
    ],
  },
  {
    kind: "playFromGraveyard",
    label: "Temetőből is játszható",
    summary: "A temető úgy viselkedik, mint a kéz kiegészítése. Ez az Umbra.",
    fields: [],
  },
  {
    kind: "startEffect",
    label: "Nyitóhatás",
    summary:
      "A csatatér elején mindkét játékosra elsül egy hatás. Lingadori könyvtár, Malom, Faloda.",
    fields: [
      { name: "effect", type: "select", label: "Melyik", default: "draw", options: ["draw", "discard", "searchDeck"] },
      { name: "cardKind", type: "select", label: "Miből", default: "both", options: ["spell", "unit", "both"] },
      { name: "count", type: "number", label: "Hány lap", default: 2, min: 1 },
    ],
  },
];

/**
 * Every effect gets the same optional gate, appended once rather than repeated
 * fourteen times. "+2 if nobody else is on the board" is then a parameter on the
 * ordinary `grantRing`, not a bespoke effect kind.
 */
const IF_FIELDS: FieldSpec[] = [
  {
    name: "if",
    type: "select",
    label: "Csak ha (feltétel)",
    default: "always",
    options: [...STATIC_CONDITIONS],
    help: "A hatást kiváltó egységre nézve értékelődik ki. Az 'always' azt jelenti, hogy nincs feltétel.",
  },
  { name: "ifValue", type: "number", label: "Feltétel küszöbe", default: 0, min: 0 },
  {
    name: "ifKeyword",
    type: "keyword",
    label: "Csak ha ilyen kulcsszavú",
    default: "",
    help: "Vesszővel több is megadható, és bármelyik elég. A Sújtás így méri az Élettelent.",
  },
  {
    name: "ifNotKeyword",
    type: "keyword",
    label: "Csak ha NEM ilyen kulcsszavú",
    default: "",
  },
];

for (const spec of EFFECT_SPECS) spec.fields = [...spec.fields, ...IF_FIELDS];

export const AUTO_TARGET_SCOPES = [
  "self",
  "opposed",
  "allEnemy",
  "allAlly",
  "allOther",
  "adjacentAlly",
  "adjacentEnemy",
  "diagonalAlly",
  "diagonalEnemy",
  "diagonalAny",
  "columnEnemy",
  "columnFrontAlly",
  "columnBackAlly",
  "trigger",
  "none",
] as const;

export const AUTO_TARGET_PICKS = ["all", "weakest", "strongest", "highestSpellpower"] as const;

export const TRIGGER_EVENTS = [
  "onAnyDeath",
  "onAllyMove",
  "onMustra",
  "onLocationWon",
  "onLocationLost",
  "onLocationStart",
] as const;

export const TARGET_SIDES = ["enemy", "ally", "self", "any"] as const;

/**
 * The six schools. Two old names are gone: `Állat` was folded into `Bestia`, and
 * `Ravaszság` was renamed `Zsivány` after the class it belongs to. Both survive
 * as keywords only.
 */
export const SCHOOLS = ["Mágus", "Feketemágus", "Harcos", "Zsivány", "Druida", "Bestia"] as const;

export const RARITIES = ["Gyakori", "Ritka", "Kivételes", "Legendás"] as const;

export function specFor(kind: string, table: KindSpec[]): KindSpec | undefined {
  return table.find((s) => s.kind === kind);
}

/** Builds a parameter object filled with the spec's declared defaults. */
export function defaultsFor(spec: KindSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: spec.kind };
  for (const field of spec.fields) {
    if ((field.type === "keyword" || field.type === "text") && field.default === "") continue;
    out[field.name] = field.default;
  }
  return out;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateAgainstSpec(
  value: Record<string, unknown>,
  table: KindSpec[],
  path: string,
): ValidationIssue[] {
  const spec = specFor(String(value.kind), table);
  if (!spec) return [{ path, message: `Unknown kind "${String(value.kind)}"` }];
  const issues: ValidationIssue[] = [];
  for (const field of spec.fields) {
    const v = value[field.name];
    if (v === undefined) continue; // optional; the handler falls back to its default
    if (field.type === "number" && typeof v !== "number") {
      issues.push({ path: `${path}.${field.name}`, message: "expected a number" });
    }
    if (field.type === "boolean" && typeof v !== "boolean") {
      issues.push({ path: `${path}.${field.name}`, message: "expected true/false" });
    }
    if (field.type === "select" && !field.options.includes(String(v))) {
      issues.push({
        path: `${path}.${field.name}`,
        message: `expected one of ${field.options.filter(Boolean).join(", ")}`,
      });
    }
  }
  return issues;
}
