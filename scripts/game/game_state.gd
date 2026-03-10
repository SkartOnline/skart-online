## GameState — root container for all game state.
## Provides typed access: state.ally().hand.cards, state.arena.tile(r,c).unit, etc.
## Replaces the flat var soup in GameManager.
class_name GameState
extends RefCounted

const PlayerStateScript = preload("res://scripts/game/player_state.gd")
const ArenaStateScript = preload("res://scripts/game/arena_state.gd")
const ModifierScript = preload("res://scripts/abilities/modifier.gd")

## The two players. Index 0 = local player, index 1 = opponent.
var players: Array = []  ## Array[PlayerState]

## The board.
var arena = null

## Turn tracking.
var turn_number: int = 0
var turn_owner_id: int = 0  ## 0 = local, 1 = opponent

## Global modifiers (cost/damage modifiers not tied to a unit).
var global_modifiers: Array = []  ## Array[Modifier]

## Base rows (which row is each player's base).
var player_base_row: int = 4
var enemy_base_row: int = 0

func _init() -> void:
	players = [
		PlayerStateScript.new(0, false),   # Local player — full card data
		PlayerStateScript.new(1, true),    # Opponent — hidden by default
	]
	arena = ArenaStateScript.new()

# ── Player access ──

func ally():
	return players[0]

func enemy():
	return players[1]

func player(id: int):
	if id >= 0 and id < players.size():
		return players[id]
	return null

func current_turn_player():
	return player(turn_owner_id)

func opponent_of(id: int):
	return player(1 - id)

# ── Zone resolution by name string ──
## Resolves zone names like "MyDeck", "EnemyHand", "AllyGraveyard", etc.
func resolve_zone(zone_name: String, perspective_id: int = 0):
	# Determine owner
	var p = null
	var name_lower := zone_name.to_lower()
	if name_lower.begins_with("my") or name_lower.begins_with("ally"):
		p = player(perspective_id)
	elif name_lower.begins_with("enemy") or name_lower.begins_with("opponent"):
		p = opponent_of(perspective_id)
	else:
		# Default to ally
		p = player(perspective_id)

	# Strip prefix to get zone type
	var stripped := zone_name
	for prefix in ["My", "my", "Ally", "ally", "Enemy", "enemy", "Opponent", "opponent"]:
		if stripped.begins_with(prefix):
			stripped = stripped.substr(prefix.length())
			break
	# Strip "Top"/"Bottom" suffixes — caller handles position
	stripped = stripped.replace("Top", "").replace("Bottom", "")
	if stripped.is_empty():
		return null
	return p.zone_by_name(stripped)

# ── Global modifier helpers ──

func add_global_modifier(mod) -> void:
	global_modifiers.append(mod)

func cleanup_expired_modifiers(phase: String) -> void:
	for i in range(global_modifiers.size() - 1, -1, -1):
		var mod = global_modifiers[i]
		if mod.is_expired(turn_number, phase):
			global_modifiers.remove_at(i)

# ── Serialization ──

func serialize() -> Dictionary:
	return {
		"turn_number": turn_number,
		"turn_owner_id": turn_owner_id,
		"player_base_row": player_base_row,
		"enemy_base_row": enemy_base_row,
		"ally": players[0].serialize(),
		"enemy": players[1].serialize(),
		"arena": arena.serialize(),
	}

func load_from_data(data: Dictionary) -> void:
	turn_number = int(data.get("turn_number", 0))
	turn_owner_id = int(data.get("turn_owner_id", 0))
	player_base_row = int(data.get("player_base_row", 4))
	enemy_base_row = int(data.get("enemy_base_row", 0))
	if data.has("ally"):
		players[0].load_from_data(data["ally"])
	if data.has("enemy"):
		players[1].load_from_data(data["enemy"])
