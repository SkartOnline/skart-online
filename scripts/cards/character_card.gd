## Character card — selected before the game, provides passive abilities.
class_name CharacterCard
extends "res://scripts/cards/card.gd"

@export var title: String = ""                  ## e.g. "a Néma Tüzek Őre"
@export var signature_card_ids: Array = []      ## IDs of signature cards
@export var deckbuilding_rules: Dictionary = {}  ## e.g. {"sidedeck":{"max":3,"filter":"..."}}

func _init() -> void:
    card_type = CardType.CHARACTER

func get_full_name() -> String:
    return "%s, %s" % [card_name, title] if title != "" else card_name

func get_summary() -> String:
    var ability_text := get_ability_text()
    return "%s [Karakter | %s] %s" % [get_full_name(), card_class, ability_text]