## Unit card — placed on the 5x5 arena grid, has Attack and HP stats.
class_name UnitCard
extends "res://scripts/cards/card.gd"

@export var attack: int = 0
@export var hp: int = 1
@export var move_speed: int = 1
@export var attack_range: int = 1  ## Lövéstáv

func _init() -> void:
    card_type = CardType.UNIT

func get_summary() -> String:
    var ability_text := get_ability_text()
    var at := " | %s" % ability_text if ability_text != "" else ""
    var class_text := card_class
    if card_class2 != "":
        class_text += "/" + card_class2
    return "%s [Egység | %s] ATK:%d HP:%d%s" % [card_name, class_text, attack, hp, at]
