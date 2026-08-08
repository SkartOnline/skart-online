## Card base class for Skart 2 Online
## All card types inherit from this resource.
class_name Card
extends Resource

const AbilityScript = preload("res://scripts/abilities/ability.gd")

enum CardType {
    CHARACTER,
    UNIT,
    SPELL,
    OTHER,
    WEAPON,
    TRAP,
    NATURE_FORCE,
    INSPIRATION,
    ARTIFACT,
    QUEST,
    BUILDING,
}

enum Rarity {
    COMMON,
    UNCOMMON,
    RARE,
    LEGENDARY,
    MYTHIC
}

const CARD_CLASSES: Array[String] = [
    "Harcos",
    "Mágus",
    "Vaják",
    "Zsivány",
    "Bölcs",
    "Garabonciás",
    "Csodatevő",
    "Mítikus",
]

@export var card_id: int = 0
@export var card_name: String = ""
@export var description: String = ""
@export var card_type: CardType = CardType.OTHER
@export_enum("Harcos", "Mágus", "Vaják", "Zsivány", "Bölcs", "Garabonciás", "Csodatevő", "Mítikus") var card_class: String = "Harcos"
@export var card_class2: String = ""  ## Optional secondary class; keep empty for single-class cards.
@export var art_path: String = ""
@export var cost: int = 0
@export var cost_resource: String = ""     ## What resource pays for it (mana, etc.)
@export var rarity: Rarity = Rarity.COMMON
@export var tags: Array = []               ## Subtags: "Tűz", "Undán", etc.
@export var flavor_text: String = ""
@export var abilities: Array = []  ## Array of Ability resources

func get_type_name() -> String:
    match card_type:
        CardType.CHARACTER: return "Karakter"
        CardType.UNIT: return "Egység"
        CardType.SPELL: return "Varázslat"
        CardType.WEAPON: return "Fegyver"
        CardType.TRAP: return "Csapda"
        CardType.NATURE_FORCE: return "Természeti erő"
        CardType.INSPIRATION: return "Sugallat"
        CardType.ARTIFACT: return "Artifaktum"
        CardType.QUEST: return "Küldetés"
        CardType.BUILDING: return "Épület"
        CardType.OTHER: return "Egyéb"
    return "Ismeretlen"

func get_rarity_name() -> String:
    match rarity:
        Rarity.COMMON: return "Közönséges"
        Rarity.UNCOMMON: return "Ritka"
        Rarity.RARE: return "Nagyon ritka"
        Rarity.LEGENDARY: return "Legendás"
        Rarity.MYTHIC: return "Mítikus"
    return ""

func get_ability_text() -> String:
    var parts: Array[String] = []
    var is_spell := (card_type == CardType.SPELL)
    for ab in abilities:
        if ab and ab.has_method("get_trigger_name") and ab.has_method("get_effect_text"):
            var trigger_name: String = ab.get_trigger_name(is_spell)
            if trigger_name != "":
                trigger_name += ": "
            parts.append(trigger_name + ab.get_effect_text())
    return " ".join(parts) if parts.size() > 0 else ""

func get_summary() -> String:
    return "%s [%s] - %s" % [card_name, get_type_name(), get_ability_text()]
