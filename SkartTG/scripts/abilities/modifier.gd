## Modifier — tracks one active buff/debuff/cost-modifier on a unit or player.
## Used by UnitInstance.active_modifiers and GameManager.global_modifiers.
class_name Modifier
extends RefCounted

## ========== MODIFIER TYPE ==========
const ModifierType := {
	STAT = "STAT",                ## ATK / HP / ATK_HP buff/debuff
	KEYWORD = "KEYWORD",          ## Added keyword (Roham, Ütéselőny, etc.)
	COST = "COST",                ## Cost modifier on cards
	DAMAGE = "DAMAGE",            ## Spell damage modifier
	MOVE_SPEED = "MOVE_SPEED",    ## Extra movement points
	AURA = "AURA",                ## Aura stat bonus (recomputed on board change)
}

## ========== PROPERTIES ==========

## Which card/ability created this modifier
var source_card_id: int = 0
var source_description: String = ""

## What kind of modifier
var modifier_type: String = ModifierType.STAT

## Which stat (for STAT type): "ATK", "HP", "ATK_HP"
var stat: String = ""

## Keyword name (for KEYWORD type)
var keyword: String = ""

## The modifier amount (+N or -N)
var value: int = 0

## Duration type — matches AbilityStep.Duration:
## 0=permanent, 1=end-of-turn, 2=start-of-next-turn, 3=end-of-combat,
## 4=until-used (consumed on next trigger), 5=while-attached
var duration_type: int = 0

## Turn number when this modifier was created
var applied_on_turn: int = 0

## Scope filter for COST/DAMAGE modifiers (e.g. "type:UNIT", "next_card", "source:robbery")
var scope_filter: String = ""

## Target of cost modifier: 0 = self player, 1 = opponent
var target_player: int = 0

## Whether this modifier has been consumed (for UNTIL_USED)
var consumed: bool = false

## ========== METHODS ==========

func is_expired(current_turn: int, phase: String) -> bool:
	match duration_type:
		0:  # PERMANENT
			return false
		1:  # END_OF_TURN
			return phase == "END_OF_TURN" and applied_on_turn <= current_turn
		2:  # START_OF_NEXT_TURN
			return phase == "START_OF_TURN" and current_turn > applied_on_turn
		3:  # END_OF_COMBAT
			return phase == "END_OF_COMBAT"
		4:  # UNTIL_USED
			return consumed
		5:  # WHILE_ATTACHED
			return false  # Removed explicitly when attachment detaches
		_:
			return false

func get_stat_atk_bonus() -> int:
	if modifier_type != ModifierType.STAT and modifier_type != ModifierType.AURA:
		return 0
	if stat == "ATK" or stat == "ATK_HP":
		return value
	return 0

func get_stat_hp_bonus() -> int:
	if modifier_type != ModifierType.STAT and modifier_type != ModifierType.AURA:
		return 0
	if stat == "HP" or stat == "ATK_HP":
		return value
	return 0

func get_move_speed_bonus() -> int:
	if modifier_type != ModifierType.MOVE_SPEED:
		return 0
	return value

## Create a stat modifier
static func create_stat(stat_name: String, val: int, dur: int, source_id: int = 0, turn: int = 0) -> Modifier:
	var m := Modifier.new()
	m.modifier_type = ModifierType.STAT
	m.stat = stat_name
	m.value = val
	m.duration_type = dur
	m.source_card_id = source_id
	m.applied_on_turn = turn
	return m

## Create a keyword modifier
static func create_keyword(kw: String, dur: int, source_id: int = 0, turn: int = 0) -> Modifier:
	var m := Modifier.new()
	m.modifier_type = ModifierType.KEYWORD
	m.keyword = kw
	m.duration_type = dur
	m.source_card_id = source_id
	m.applied_on_turn = turn
	return m

## Create a move speed modifier
static func create_move_speed(val: int, dur: int, source_id: int = 0, turn: int = 0) -> Modifier:
	var m := Modifier.new()
	m.modifier_type = ModifierType.MOVE_SPEED
	m.value = val
	m.duration_type = dur
	m.source_card_id = source_id
	m.applied_on_turn = turn
	return m

## Create a cost modifier (for global_modifiers)
static func create_cost(val: int, scope: String, dur: int, target: int = 0, source_id: int = 0, turn: int = 0) -> Modifier:
	var m := Modifier.new()
	m.modifier_type = ModifierType.COST
	m.value = val
	m.scope_filter = scope
	m.duration_type = dur
	m.target_player = target
	m.source_card_id = source_id
	m.applied_on_turn = turn
	return m

## Create a damage modifier
static func create_damage(val: int, scope: String, dur: int, source_id: int = 0, turn: int = 0) -> Modifier:
	var m := Modifier.new()
	m.modifier_type = ModifierType.DAMAGE
	m.value = val
	m.scope_filter = scope
	m.duration_type = dur
	m.source_card_id = source_id
	m.applied_on_turn = turn
	return m
