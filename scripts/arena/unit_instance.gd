## UnitInstance — runtime representation of a unit on the board.
## Wraps a UnitCard with mutable game state (current HP, damage, buffs, modifiers, etc.)
class_name UnitInstance
extends RefCounted

const UnitCardScript = preload("res://scripts/cards/unit_card.gd")
const ModifierScript = preload("res://scripts/abilities/modifier.gd")

var card: Resource
var owner_id: int = 0        ## 0 = player, 1 = opponent
var current_hp: int = 0
var current_attack: int = 0
var rings: int = 0           ## Gyűrűk: +1 ATK and +1 HP each
var grid_row: int = -1
var grid_col: int = -1
var has_attacked: bool = false
var has_moved: bool = false
var moves_remaining: int = 0
var keywords: Array = []
var extra_abilities: Array = []  ## Buffs/debuffs added at runtime

## Modifier stack — all active buffs/debuffs on this unit
var active_modifiers: Array = []  ## Array of Modifier

## Attached cards — weapons, enchantments, etc.
var attached_cards: Array = []  ## Array of { card_id, card_name, detach_steps, source_card }

## Persistent data stored across abilities (e.g. Ryan Cooper's named_card)
var stored_data: Dictionary = {}

func _init(source_card: Resource = null, owner: int = 0) -> void:
	if source_card:
		card = source_card
		owner_id = owner
		current_attack = card.attack
		current_hp = card.hp
		moves_remaining = card.move_speed if card.get("move_speed") else 1

func get_effective_attack() -> int:
	var base: int = current_attack + rings
	for mod in active_modifiers:
		base += mod.get_stat_atk_bonus()
	return base

func get_effective_hp() -> int:
	var base: int = current_hp + rings
	for mod in active_modifiers:
		base += mod.get_stat_hp_bonus()
	return base

func get_effective_move_speed() -> int:
	var base: int = card.move_speed if card and card.get("move_speed") else 1
	for mod in active_modifiers:
		base += mod.get_move_speed_bonus()
	return base

func has_keyword(kw: String) -> bool:
	if kw in keywords:
		return true
	for mod in active_modifiers:
		if mod.modifier_type == ModifierScript.ModifierType.KEYWORD and mod.keyword == kw:
			return true
	return false

func remove_keyword(kw: String) -> void:
	keywords.erase(kw)
	# Also remove keyword modifiers for this keyword
	for i in range(active_modifiers.size() - 1, -1, -1):
		var mod = active_modifiers[i]
		if mod.modifier_type == ModifierScript.ModifierType.KEYWORD and mod.keyword == kw:
			active_modifiers.remove_at(i)

func is_alive() -> bool:
	return get_effective_hp() > 0

func is_damaged() -> bool:
	return card != null and current_hp < card.hp

func take_damage(amount: int) -> int:
	## Apply damage. Returns actual damage dealt.
	## Rings absorb damage first (per rulebook).
	var remaining := amount
	if rings > 0:
		var ring_absorb := mini(rings, remaining)
		rings -= ring_absorb
		remaining -= ring_absorb
	if remaining > 0:
		current_hp -= remaining
	print("[UnitInstance] %s took %d damage (rings left: %d, current HP: %d, effective HP: %d)" % [
		card.card_name, amount, rings, current_hp, get_effective_hp()])
	return amount

func heal(amount: int) -> void:
	## Heal by restoring current_hp up to card.hp
	if card:
		current_hp = mini(current_hp + amount, card.hp)
	else:
		current_hp += amount

func add_ring(count: int = 1) -> void:
	## Per rulebook: if unit is damaged, rings heal first
	if card and current_hp < card.hp:
		var heal_amount := mini(card.hp - current_hp, count)
		current_hp += heal_amount
		count -= heal_amount
	rings += count

func add_modifier(mod) -> void:
	active_modifiers.append(mod)

func cleanup_expired_modifiers(current_turn: int, phase: String) -> void:
	## Remove all modifiers whose duration has expired.
	## Called at phase boundaries (end of turn, start of turn, end of combat).
	for i in range(active_modifiers.size() - 1, -1, -1):
		if active_modifiers[i].is_expired(current_turn, phase):
			active_modifiers.remove_at(i)

func get_display_name() -> String:
	return card.card_name if card else "???"

func get_stats_text() -> String:
	return "⚔%d ♥%d" % [get_effective_attack(), get_effective_hp()]

func reset_turn() -> void:
	has_attacked = false
	has_moved = false
	moves_remaining = get_effective_move_speed()