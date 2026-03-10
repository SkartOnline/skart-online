## Spell card — has various effects but no body on the arena.
class_name SpellCard
extends "res://scripts/cards/card.gd"

enum SpellType {
    INSTANT,     ## Azonnali — can be played anytime, including as reaction
    RITUAL,      ## Rítus — only on your turn, not as reaction
    REACTION,    ## Reakció — only as a reaction
    PERMANENT,   ## Permanens — stays on bench
}

@export var spell_type: SpellType = SpellType.INSTANT
@export var spell_range: int = 0         ## Hatótáv in tiles (0 = no range needed)
@export var school: String = ""          ## Iskola: Tűz, Jég, Árnyék, etc.

func _init() -> void:
    card_type = CardType.SPELL

func get_spell_type_name() -> String:
    match spell_type:
        SpellType.INSTANT: return "Azonnali"
        SpellType.RITUAL: return "Rítus"
        SpellType.REACTION: return "Reakció"
        SpellType.PERMANENT: return "Permanens"
    return ""

func get_summary() -> String:
    if card_type != CardType.SPELL:
        var ability_text_nonspell := get_ability_text()
        var at_nonspell := " | %s" % ability_text_nonspell if ability_text_nonspell != "" else ""
        return "%s [%s | %s]%s" % [card_name, get_type_name(), card_class, at_nonspell]
    var ability_text := get_ability_text()
    return "%s [%s | %s | %s] %s" % [card_name, get_spell_type_name(), school, card_class, ability_text]