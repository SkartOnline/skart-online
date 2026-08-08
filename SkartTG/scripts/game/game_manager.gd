## GameManager — handles game state, turns, and ability resolution.
## Currently implements single-player test mode only.
class_name GameManager
extends Node

const AbilityScript = preload("res://scripts/abilities/ability.gd")
const UnitInstanceScript = preload("res://scripts/arena/unit_instance.gd")
const CardScript = preload("res://scripts/cards/card.gd")
const CardDatabaseScript = preload("res://scripts/cards/card_database.gd")
const StepExecutorScript = preload("res://scripts/abilities/step_executor.gd")
const EffectPipelineScript = preload("res://scripts/abilities/effect_pipeline.gd")
const ModifierScript = preload("res://scripts/abilities/modifier.gd")
const AbilityQueueScript = preload("res://scripts/abilities/ability_queue.gd")

const VT1 := {
	NONE = "NONE",
	UNIT = "UNIT",
	ENTITY = "ENTITY",
	PLAYER = "PLAYER",
	TILE = "TILE",
	AREA = "AREA",
}

const VT2 := {
	ANY = "ANY",
	ALLY = "ALLY",
	ENEMY = "ENEMY",
}

const TM := {
	PLAYER_CHOICE = "PLAYER_CHOICE",
}

signal card_drawn(card)
signal card_played(card, row: int, col: int)
signal unit_damaged(unit, amount: int)
signal unit_died(unit)
signal player_hp_changed(player_id: int, new_hp: int)
signal ability_triggered(ability, source)
@warning_ignore("unused_signal")
signal choose_one_requested(choices: Array, callback: Callable)
signal target_requested(valid_target: String, range_val: int, source_row: int, source_col: int, callback: Callable)
signal hand_updated()
signal game_log(message: String)
signal game_won()
signal game_lost()
signal state_changed(snapshot: Dictionary)
@warning_ignore("unused_signal")
signal steal_from_hand_requested(enemy_hand_cards: Array, callback: Callable)  ## UI shows opponent hand cards for revealed-pick effects
signal ring_target_requested(callback: Callable)  ## UI lets player pick allied unit for ring
signal hand_card_target_requested(valid_indices: Array, callback: Callable)  ## UI lets player pick card from hand
@warning_ignore("unused_signal")
signal discard_from_hand_requested(valid_indices: Array, to_exile: bool, callback: Callable)  ## UI: pick card to discard/exile
@warning_ignore("unused_signal")
signal search_pick_requested(shown_cards: Array, select_count: int, prompt: String, callback: Callable)  ## UI: pick card(s) from search results
signal end_turn_state_ready  ## Emitted after ON_TURN_END abilities complete — safe to serialize

## Game state — player
var player_hp: int = 20
var player_characters: Array = []  ## Array of character cards
var player_deck: Array = []
var player_hand: Array[Resource] = []
var player_discard: Array = []  ## Temető — dead units go here
var player_pile: Array = []     ## Rakás — used spells go here
var player_mana: int = 0
var player_max_mana: int = 0
var turn_number: int = 0

## Game state — enemy
var enemy_hp: int = 20
var enemy_mana: int = 0
var enemy_max_mana: int = 0
var enemy_hand_count: int = 0

## Enemy private data (stored for MP sync, not used in game logic)
var enemy_characters: Array = []
var enemy_deck_ids: Array = []   ## card IDs
var enemy_hand_ids: Array = []   ## card IDs
var enemy_discard_ids: Array = []
var enemy_pile_ids: Array = []

## Multiplayer state
var mp_mode: bool = false
var dev_mode: bool = false
var mp_my_user_id: int = 0
var mp_opponent_user_id: int = 0
var mp_is_first_player: bool = true
var mp_opponent_name: String = ""

## Grid: 5x5, each cell is either null or a UnitInstance
var grid: Array = []  ## Array of Arrays of UnitInstance-or-null
const GRID_ROWS := 5
const GRID_COLS := 5

## Dynamic base rows: player 1 (first) = top (0), player 2 (second/test) = bottom (4)
## Both players see the SAME board — no perspective flipping.
var player_base_row: int = 4   ## My base row. Default = bottom (test/player2)
var enemy_base_row: int = 0    ## Enemy base row. Default = top (test/player2)

## Whether any interactive state is active (targeting, choosing, etc.)
## Arena checks this to disable other interactions
func is_interactive_state_active() -> bool:
	return _awaiting_target or _awaiting_choice or _awaiting_hand_card or _awaiting_discard_from_hand or _awaiting_ring_target

## Currently waiting for player to choose a target
var _awaiting_target: bool = false
var _target_callback: Callable
var _target_valid: String = VT1.NONE
var _target_valid_2: String = VT2.ANY
var _target_valid_3: String = ""
var _target_range: int = 0
var _target_source_row: int = -1
var _target_source_col: int = -1
var _target_use_source: bool = false  ## If true, range checks from source pos

## Currently waiting for player to choose one ability
var _awaiting_choice: bool = false
var _choice_callback: Callable

## Command state (Bodur's ALLY_UNIT_COMMAND)
var _command_cost_limit: int = 0  ## Max cost (exclusive) for command targets

## ─── NEW ABILITY STATE ───
## Gyorshitel: next card cost reduction
var _next_card_cost_modifier: int = 0       ## Applies to the very next card played
var _mana_penalty_next_turn: int = 0        ## Subtracted from available mana at next turn start

## Határzár: opponent unit cost increase for their next turn
var _opponent_unit_cost_increase: int = 0   ## Applied when opponent plays units (MP only)
## When WE receive a Határzár from the opponent, this tracks it locally:
var _my_unit_cost_increase: int = 0         ## Extra cost on our units this turn

## Weapon tracking: maps grid position "row,col" → Array of weapon card IDs attached
var _weapons_on_units: Dictionary = {}      ## { "row,col": [{ card_id, card_name, buff_atk }] }

## Step executor engine — processes step chains within a single ability
var executor: StepExecutorScript = null

## Ability queue — central sequencer for all triggered abilities
var ability_queue: AbilityQueueScript = null

## Global modifier list — cost/damage modifiers that aren't on a specific unit
var global_modifiers: Array = []  ## Array of Modifier

## Steal from hand state (Újraelosztás)
var _steal_spell_card = null  ## The spell card being resolved

## Ring system (Gyűrű) — rings on bench, clickable to apply +1/+1 to allied unit
var player_rings: int = 0
var _awaiting_ring_target: bool = false
var _ring_target_callback: Callable

## Hand card targeting state (Mozgósítás) — select cards from own hand
var _awaiting_hand_card: bool = false
var _hand_card_callback: Callable
var _hand_card_valid_indices: Array = []
var _mobilize_remaining: int = 0
@warning_ignore("unused_private_class_variable")
var _mobilize_spell_card = null  ## Legacy — kept for old mobilize flow

## Griff character: tracks discards this turn (ON_DISCARD trigger)
var _discards_this_turn: int = 0

## Ryan Cooper: named cards — maps "row,col" → card_id
var _named_cards: Dictionary = {}

## Exile zone (Bolyongó: permanently removed cards, cannot be recovered)
var player_exile: Array = []

## Side deck zone (Felix: extra cards playable via portal ability)
var player_side_deck: Array = []

## Zsalu character: robbery cost modifier (legacy, now uses global_modifiers)
## Kept for reference but value is read from global_modifiers via step executor.

## Override for constrained tile picking (e.g. Papagáj adjacent tiles)
var _valid_tile_override: Array = []

## Discard-from-hand selection state (Lomtalanítás, Bolyongó)
var _awaiting_discard_from_hand: bool = false
var _discard_hand_callback: Callable

## Turn flow
var turn_owner_id: int = 0  ## 0 = local player, 1 = opponent

func _ready() -> void:
	_init_grid()
	executor = StepExecutorScript.new(self)
	ability_queue = AbilityQueueScript.new(self, executor)

func _init_grid() -> void:
	grid.clear()
	for row in range(GRID_ROWS):
		var row_data: Array = []
		for col in range(GRID_COLS):
			row_data.append(null)
		grid.append(row_data)

## ===========================
## GAME SETUP
## ===========================

## ===========================
## MULTIPLAYER GAME SETUP
## ===========================

func setup_multiplayer_game(my_user_id: int, opponent_user_id: int,
		my_char_cards: Array, my_deck_card_ids: Array,
		opp_char_ids: Array, opp_deck_card_ids: Array,
		is_first_player: bool, opp_name: String, my_side_deck_ids: Array = []) -> void:
	mp_mode = true
	mp_my_user_id = my_user_id
	mp_opponent_user_id = opponent_user_id
	mp_is_first_player = is_first_player
	mp_opponent_name = opp_name

	# Set base rows: player 1 at top (0), player 2 at bottom (4)
	# Both players see the SAME board orientation.
	if is_first_player:
		player_base_row = 0
		enemy_base_row = 4
	else:
		player_base_row = 4
		enemy_base_row = 0

	_init_grid()
	player_characters = my_char_cards.duplicate()
	player_hp = 20

	# Build my deck from card IDs
	player_deck.clear()
	for card_id in my_deck_card_ids:
		var card = CardDatabaseScript.get_card(int(card_id))
		if card:
			player_deck.append(card)
		else:
			game_log.emit("FIGYELEM: Kártya ID %d nem található!" % int(card_id))

	# Build side deck from card IDs
	player_side_deck.clear()
	for card_id in my_side_deck_ids:
		var card = CardDatabaseScript.get_card(int(card_id))
		if card:
			player_side_deck.append(card)

	# Store opponent data for sync
	enemy_characters.clear()
	for cid in opp_char_ids:
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			enemy_characters.append(card)
	enemy_hp = 20
	enemy_deck_ids = opp_deck_card_ids.duplicate()
	enemy_hand_ids.clear()
	enemy_discard_ids.clear()
	enemy_pile_ids.clear()
	enemy_mana = 0
	enemy_max_mana = 0

	player_hand.clear()
	player_discard.clear()
	player_pile.clear()
	player_exile.clear()
	player_mana = 0
	player_max_mana = 0
	turn_number = 0
	turn_owner_id = 0

	# Deal opening hands
	for i in range(mini(5, player_deck.size())):
		_draw_card()
	for i in range(mini(5, enemy_deck_ids.size())):
		enemy_hand_ids.append(enemy_deck_ids.pop_back())
	enemy_hand_count = enemy_hand_ids.size()

	if is_first_player:
		start_turn()
	else:
		# Opponent goes first — wait for their state update
		turn_owner_id = 1
		enemy_max_mana = 1
		enemy_mana = 1

	hand_updated.emit()
	_emit_state_changed()
	game_log.emit("Multiplayer játék elindult! Ellenfél: %s" % opp_name)
	game_log.emit("Pozíció: %s (base=%d), Pakli: %d, Kéz: %d, Ellenf. chars: %d" % [
		"Első" if is_first_player else "Második", player_base_row,
		player_deck.size(), player_hand.size(), enemy_characters.size()])
	_self_test_abilities()

func _self_test_abilities() -> void:
	game_log.emit(">>> ENGINE v3 <<<")
	var test_ids := [2010, 3010]
	for tid in test_ids:
		var card = CardDatabaseScript.get_card(tid)
		if card == null:
			game_log.emit("SELFTEST FAIL: id=%d null" % tid)
			continue
		var info := "TEST %s: ab=%d" % [card.card_name, card.abilities.size()]
		for i in range(card.abilities.size()):
			var ab = card.abilities[i]
			if ab == null:
				info += " [%d:NULL]" % i
				continue
			var ev: String = ab.trigger.event if ab.trigger != null else ""
			var sc: int = ab.effects.size() if ab.effects != null else 0
			info += " [%s ev=%s eff=%d]" % [ab.ability_name, ev, sc]
		game_log.emit(info)

## ===========================
## SERIALIZE / LOAD STATE FOR SERVER
## ===========================

func serialize_for_server() -> Dictionary:
	## Export full game state as JSON-safe dictionary for server storage.
	## Grid is stored in "server" orientation (first player base = row 0).
	var grid_data := []
	for row in range(GRID_ROWS):
		var row_arr := []
		for col in range(GRID_COLS):
			var unit = grid[row][col]
			if unit:
				row_arr.append({
					"card_id": unit.card.card_id,
					"owner_user_id": mp_my_user_id if unit.owner_id == 0 else mp_opponent_user_id,
					"current_attack": unit.current_attack,
					"current_hp": unit.current_hp,
					"has_moved": unit.has_moved,
					"moves_remaining": unit.moves_remaining,
					"has_attacked": unit.has_attacked,
					"rings": unit.rings,
					"keywords": unit.keywords.duplicate(),
				})
			else:
				row_arr.append(null)
		grid_data.append(row_arr)

	# No flipping — both players see the same board.
	# Server stores grid in canonical orientation (row 0 = top).

	# Serialize card arrays as IDs
	var my_hand_ids := []
	for card in player_hand:
		my_hand_ids.append(card.card_id)
	var my_deck_ids := []
	for card in player_deck:
		my_deck_ids.append(card.card_id)
	var my_discard_ids := []
	for card in player_discard:
		my_discard_ids.append(card.card_id)
	var my_pile_ids := []
	for card in player_pile:
		my_pile_ids.append(card.card_id)
	var my_exile_ids := []
	for card in player_exile:
		my_exile_ids.append(card.card_id)
	var my_char_ids := []
	for card in player_characters:
		my_char_ids.append(card.card_id)
	var opp_char_ids := []
	for card in enemy_characters:
		opp_char_ids.append(card.card_id)

	var first_uid: int = mp_my_user_id if mp_is_first_player else mp_opponent_user_id
	var second_uid: int = mp_opponent_user_id if mp_is_first_player else mp_my_user_id

	var winner: int = 0
	if enemy_hp <= 0:
		winner = mp_my_user_id
	elif player_hp <= 0:
		winner = mp_opponent_user_id

	return {
		"turn_number": turn_number,
		"current_turn_user_id": mp_my_user_id if turn_owner_id == 0 else mp_opponent_user_id,
		"first_player_user_id": first_uid,
		"second_player_user_id": second_uid,
		"winner_user_id": winner,
		"grid": grid_data,
		"players": {
			str(mp_my_user_id): {
				"username": "",
				"hp": player_hp,
				"mana": player_mana,
				"max_mana": player_max_mana,
				"hand": my_hand_ids,
				"deck": my_deck_ids,
				"discard": my_discard_ids,
				"pile": my_pile_ids,
				"exile": my_exile_ids,
				"characters": my_char_ids,
				"rings": player_rings,
			},
			str(mp_opponent_user_id): {
				"username": mp_opponent_name,
				"hp": enemy_hp,
				"mana": enemy_mana,
				"max_mana": enemy_max_mana,
				"hand": enemy_hand_ids.duplicate(),
				"deck": enemy_deck_ids.duplicate(),
				"discard": enemy_discard_ids.duplicate(),
				"pile": enemy_pile_ids.duplicate(),
				"characters": opp_char_ids,
				"rings": 0,  # We don't know opponent's ring count
			}
		},
		"ability_modifiers": {
			str(mp_my_user_id): {
				"opponent_unit_cost_increase": _opponent_unit_cost_increase,
				"next_card_cost_modifier": _next_card_cost_modifier,
				"mana_penalty_next_turn": _mana_penalty_next_turn,
			},
		},
		"weapons": _weapons_on_units.duplicate(),
		"named_cards": _named_cards.duplicate(),
	}

func load_state_from_server(data: Dictionary) -> void:
	## Load full game state from server JSON, mapping to my perspective.
	dev_mode = bool(data.get("dev_mode", false))
	turn_number = int(data.get("turn_number", 0))
	var current_uid := int(data.get("current_turn_user_id", 0))
	var new_turn_owner := 0 if current_uid == mp_my_user_id else 1
	var was_opponent_turn := (turn_owner_id == 1)

	turn_owner_id = new_turn_owner

	var players_dict: Dictionary = data.get("players", {})
	var my_data: Dictionary = players_dict.get(str(mp_my_user_id), {})
	var opp_data: Dictionary = players_dict.get(str(mp_opponent_user_id), {})

	# Load my state
	player_hp = int(my_data.get("hp", 20))
	player_mana = int(my_data.get("mana", 0))
	player_max_mana = int(my_data.get("max_mana", 0))
	player_rings = int(my_data.get("rings", 0))

	player_hand.clear()
	for cid in my_data.get("hand", []):
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			player_hand.append(card)

	player_deck.clear()
	for cid in my_data.get("deck", []):
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			player_deck.append(card)

	player_discard.clear()
	for cid in my_data.get("discard", []):
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			player_discard.append(card)

	player_pile.clear()
	for cid in my_data.get("pile", []):
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			player_pile.append(card)

	player_characters.clear()
	for cid in my_data.get("characters", []):
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			player_characters.append(card)

	# Load opponent state
	enemy_hp = int(opp_data.get("hp", 20))
	enemy_mana = int(opp_data.get("mana", 0))
	enemy_max_mana = int(opp_data.get("max_mana", 0))
	enemy_hand_ids = []
	for cid in opp_data.get("hand", []):
		enemy_hand_ids.append(int(cid))
	enemy_deck_ids = []
	for cid in opp_data.get("deck", []):
		enemy_deck_ids.append(int(cid))
	enemy_discard_ids = []
	for cid in opp_data.get("discard", []):
		enemy_discard_ids.append(int(cid))
	enemy_pile_ids = []
	for cid in opp_data.get("pile", []):
		enemy_pile_ids.append(int(cid))
	enemy_hand_count = enemy_hand_ids.size()

	enemy_characters.clear()
	for cid in opp_data.get("characters", []):
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			enemy_characters.append(card)

	# Load grid — no flipping, both players see the same board
	var grid_data: Array = data.get("grid", [])

	_init_grid()
	for row in range(mini(GRID_ROWS, grid_data.size())):
		var row_data: Array = grid_data[row]
		for col in range(mini(GRID_COLS, row_data.size())):
			var cell = row_data[col]
			if cell != null and cell is Dictionary:
				var cid := int(cell.get("card_id", 0))
				var owner_uid := int(cell.get("owner_user_id", 0))
				var oid := 0 if owner_uid == mp_my_user_id else 1
				var card = CardDatabaseScript.get_card(cid)
				if card:
					var unit = UnitInstanceScript.new(card, oid)
					unit.grid_row = row
					unit.grid_col = col
					unit.current_attack = int(cell.get("current_attack", card.attack))
					unit.current_hp = int(cell.get("current_hp", card.hp))
					unit.has_moved = bool(cell.get("has_moved", false))
					unit.moves_remaining = int(cell.get("moves_remaining", 0 if unit.has_moved else (card.move_speed if card.get("move_speed") else 1)))
					unit.has_attacked = bool(cell.get("has_attacked", false))
					unit.rings = int(cell.get("rings", 0))
					grid[row][col] = unit

	# Load ability modifiers — pick up what the opponent set for us
	var ability_mods: Dictionary = data.get("ability_modifiers", {})
	var opp_mods: Dictionary = ability_mods.get(str(mp_opponent_user_id), {})
	# If opponent used Határzár, their "opponent_unit_cost_increase" becomes our cost increase
	var opp_cost_inc: int = int(opp_mods.get("opponent_unit_cost_increase", 0))
	if opp_cost_inc > 0 and _my_unit_cost_increase == 0:
		_my_unit_cost_increase = opp_cost_inc
		game_log.emit("⚠ Határzár: Egységeid +%d-vel többe kerülnek ebben a körben!" % opp_cost_inc)

	# Load weapon state
	var weapon_data: Dictionary = data.get("weapons", {})
	_weapons_on_units = weapon_data.duplicate()

	# If it just became my turn (opponent ended), process turn start
	if new_turn_owner == 0 and was_opponent_turn:
		start_turn()
		return

	# Check winner
	var winner_uid := int(data.get("winner_user_id", 0))
	if winner_uid == mp_my_user_id:
		game_won.emit()
	elif winner_uid != 0:
		game_log.emit("VERESÉG!")
		game_lost.emit()

	hand_updated.emit()
	_emit_state_changed()

func is_player_turn() -> bool:
	return turn_owner_id == 0

func get_state_snapshot() -> Dictionary:
	return {
		"turn_owner_id": turn_owner_id,
		"turn_number": turn_number,
		"player": {
			"hp": player_hp,
			"mana": player_mana,
			"max_mana": player_max_mana,
			"deck_count": player_deck.size(),
			"discard_count": player_discard.size(),
			"pile_count": player_pile.size(),
			"hand_count": player_hand.size(),
			"rings": player_rings
		},
		"enemy": {
			"hp": enemy_hp,
			"mana": enemy_mana,
			"max_mana": enemy_max_mana,
			"hand_count": enemy_hand_count,
			"deck_count": enemy_deck_ids.size(),
			"discard_count": enemy_discard_ids.size(),
			"pile_count": enemy_pile_ids.size()
		},
		"grid": grid,
		"player_hand": player_hand,
		"player_discard": player_discard,
		"player_pile": player_pile,
		"player_characters": player_characters,
	}

func _emit_state_changed() -> void:
	state_changed.emit(get_state_snapshot())

func _action_ok(extra: Dictionary = {}) -> Dictionary:
	var result := {
		"ok": true
	}
	for k in extra.keys():
		result[k] = extra[k]
	_emit_state_changed()
	return result

func _action_error(message: String) -> Dictionary:
	return {
		"ok": false,
		"error": message
	}

func issue_action(action: String, payload: Dictionary = {}) -> Dictionary:
	var action_name := action.to_upper()

	if action_name == "END_TURN":
		if turn_owner_id != 0:
			return _action_error("Nem a te köröd.")
		# Block END_TURN during active async flows
		if _awaiting_target or _awaiting_choice or _awaiting_hand_card or _awaiting_discard_from_hand or _awaiting_ring_target:
			return _action_error("Célpont/válasz kiválasztás folyamatban!")
		# Határzár received from opponent applies only for this completed turn.
		if _my_unit_cost_increase != 0:
			game_log.emit("⚠ Határzár lejárt! Egységek költsége visszaáll.")
			_my_unit_cost_increase = 0
		# Dispatch ON_TURN_END abilities (e.g. Altus "Utánpótlás")
		# Set turn owner BEFORE dispatch so serialization is correct
		turn_owner_id = 1
		game_log.emit("Kör vége. %s következik..." % mp_opponent_name)
		ability_queue.dispatch_event("ON_TURN_END", {}, func() -> void:
			_emit_state_changed()
			end_turn_state_ready.emit()
		)
		return _action_ok()

	if turn_owner_id != 0:
		return _action_error("Nem a te köröd.")

	match action_name:
		"MOVE_UNIT":
			var moved := move_unit(
				int(payload.get("from_row", -1)),
				int(payload.get("from_col", -1)),
				int(payload.get("to_row", -1)),
				int(payload.get("to_col", -1))
			)
			if not moved:
				return _action_error("Sikertelen mozgás.")
			return _action_ok()
		"ATTACK_UNIT":
			var attacked := attack_unit(
				int(payload.get("atk_row", -1)),
				int(payload.get("atk_col", -1)),
				int(payload.get("def_row", -1)),
				int(payload.get("def_col", -1))
			)
			if not attacked:
				return _action_error("Sikertelen támadás.")
			return _action_ok()
		"ATTACK_PLAYER":
			var attacked_player := attack_enemy_player(
				int(payload.get("row", -1)),
				int(payload.get("col", -1))
			)
			if not attacked_player:
				return _action_error("Sikertelen közvetlen támadás.")
			return _action_ok()
		"PLAY_UNIT":
			var played_unit := play_unit(
				int(payload.get("hand_index", -1)),
				int(payload.get("row", -1)),
				int(payload.get("col", -1))
			)
			if not played_unit:
				return _action_error("Sikertelen kijátszás.")
			return _action_ok()
		"PLAY_SPELL":
			var played_spell := play_spell(int(payload.get("hand_index", -1)))
			if not played_spell:
				return _action_error("Sikertelen varázslat kijátszás.")
			return _action_ok()
		"SUBMIT_TARGET":
			var submitted_target := submit_target(
				int(payload.get("row", -1)),
				int(payload.get("col", -1))
			)
			if not submitted_target:
				return _action_error("Érvénytelen célpont.")
			return _action_ok()
		"SUBMIT_TARGET_PLAYER":
			var submitted_player := submit_target_player()
			if not submitted_player:
				return _action_error("Az ellenfél nem célozható.")
			return _action_ok()
		"SUBMIT_TARGET_SELF_PLAYER":
			var submitted_self := submit_target_self_player()
			if not submitted_self:
				return _action_error("Saját magad nem célozható ezzel a varázslattal.")
			return _action_ok()
		"SUBMIT_CHOICE":
			submit_choice(int(payload.get("choice_index", -1)))
			return _action_ok()
		"USE_RING":
			var used_ring := use_ring()
			if not used_ring:
				return _action_error("Nincs gyűrűd, vagy nem tudsz gyűrűt használni.")
			return _action_ok()
		"SUBMIT_RING_TARGET":
			var applied := submit_ring_target(
				int(payload.get("row", -1)),
				int(payload.get("col", -1))
			)
			if not applied:
				return _action_error("Érvénytelen gyűrű célpont.")
			return _action_ok()
		"SUBMIT_HAND_CARD":
			var submitted := submit_hand_card(int(payload.get("hand_index", -1)))
			if not submitted:
				return _action_error("Érvénytelen kártya kiválasztás.")
			return _action_ok()
		"SKIP_HAND_CARD":
			skip_hand_card_selection()
			return _action_ok()
		"ACTIVATE_ABILITY":
			var activated := activate_ability(
				int(payload.get("row", -1)),
				int(payload.get("col", -1)),
				int(payload.get("ability_index", 0))
			)
			if not activated:
				return _action_error("Sikertelen képesség aktiválás.")
			return _action_ok()
		_:
			return _action_error("Ismeretlen akció: %s" % action)

## ===========================
## TURNS
## ===========================

func start_turn() -> void:
	turn_owner_id = 0
	turn_number += 1

	# Gain mana
	if player_max_mana < 10:
		player_max_mana += 1

	player_mana = player_max_mana

	# Apply mana penalty (Gyorshitel: -2 available mana this turn, max mana unchanged)
	if _mana_penalty_next_turn != 0:
		player_mana = maxi(0, player_mana - _mana_penalty_next_turn)
		game_log.emit("⚠ Gyorshitel: -%d elérhető mana ebben a körben!" % _mana_penalty_next_turn)
		_mana_penalty_next_turn = 0
	# Also consume global "mana_penalty" modifiers
	for i in range(global_modifiers.size() - 1, -1, -1):
		if global_modifiers[i].modifier_type == ModifierScript.ModifierType.COST and global_modifiers[i].scope_filter == "mana_penalty":
			var penalty: int = global_modifiers[i].value
			player_mana = maxi(0, player_mana - penalty)
			game_log.emit("⚠ Gyorshitel: -%d elérhető mana ebben a körben!" % penalty)
			global_modifiers.remove_at(i)

	# Our outgoing Határzár expires after opponent completed their turn.
	if _opponent_unit_cost_increase != 0:
		_opponent_unit_cost_increase = 0

	# Reset Griff discard counter for new turn
	_discards_this_turn = 0

	# Reset PER_TURN trigger limit counters
	ability_queue.clear_turn_limits()

	# Ensure CONTINUOUS character passives are in global_modifiers
	# Remove old robbery modifier first, then re-add if character with it is in play
	for i in range(global_modifiers.size() - 1, -1, -1):
		if global_modifiers[i].scope_filter == "source:robbery":
			global_modifiers.remove_at(i)
	for character in player_characters:
		for ab in character.abilities:
			if ab.trigger != null and ab.trigger.event == "CONTINUOUS":
				# Check if ability targets stolen cards with a cost modifier
				var has_stolen_target: bool = false
				if ab.get("targets") and ab.targets is Array:
					for tgt in ab.targets:
						var cond: String = tgt.condition if tgt.get("condition") else ""
						if "tag:stolen" in cond or "has_tag:stolen" in cond:
							has_stolen_target = true
				if has_stolen_target:
					for step in ab.steps:
						if step and step.step == "ModifyStat" and String(step.parameters.get("ModifiedStat", "")) == "COST":
							var mod = ModifierScript.create_cost(step.parameters.get("ModifyAmount", 0), "source:robbery", 0, 0, 0, turn_number)
							global_modifiers.append(mod)

	# Enemy mana is managed via server state sync in MP mode

	# Reset my units + clean up expired modifiers
	for row in range(GRID_ROWS):
		for col in range(GRID_COLS):
			var unit = grid[row][col]
			if unit and unit.owner_id == 0:
				unit.cleanup_expired_modifiers(turn_number, "START_OF_TURN")
				unit.reset_turn()

	# Clean up global modifiers at turn start
	_cleanup_global_modifiers("START_OF_TURN")

	# Draw a card (skip for starting player's first turn)
	if turn_number > 1:
		_draw_card()

	# Fire CONTINUOUS character passives (e.g. Főtus dragon buffs)
	# These are sync-only effects (ModifyStat/ModifyKeyword) so they complete before _emit_state_changed.
	ability_queue.dispatch_event("CONTINUOUS", {"event_source_owner": 0})

	hand_updated.emit()
	game_log.emit("=== %d. kör === Mana: %d/%d" % [turn_number, player_mana, player_max_mana])
	_emit_state_changed()

## Activate an ACTIVATED ability on a board unit or character.
func activate_ability(row: int, col: int, ability_index: int = 0) -> bool:
	# Row -1 means character activation
	if row == -1:
		if col < 0 or col >= player_characters.size():
			return false
		var character = player_characters[col]
		if character == null:
			return false
		var char_abilities: Array = []
		for ab in character.abilities:
			if ab.trigger != null and ab.trigger.event == "ACTIVATED":
				char_abilities.append(ab)
		if ability_index < 0 or ability_index >= char_abilities.size():
			return false
		var char_ab = char_abilities[ability_index]
		if char_ab.trigger != null and not char_ab.trigger.matches("ACTIVATED", {}, character, null, self, ability_queue.limit_counts):
			return false
		game_log.emit("⚡ %s: %s aktiválva!" % [character.card_name, char_ab.ability_name])
		ability_queue.dispatch_event("ACTIVATED", {"played_card": character, "event_source_owner": 0})
		return true

	# Board unit activation
	if row < 0 or row >= GRID_ROWS or col < 0 or col >= GRID_COLS:
		return false
	var unit = grid[row][col]
	if unit == null or unit.owner_id != 0:
		return false
	var activated_abilities: Array = []
	for ab in unit.card.abilities:
		if ab.trigger != null and ab.trigger.event == "ACTIVATED":
			activated_abilities.append(ab)
	if ability_index < 0 or ability_index >= activated_abilities.size():
		return false
	var ab = activated_abilities[ability_index]
	if ab.trigger != null and not ab.trigger.matches("ACTIVATED", {}, unit.card, unit, self, ability_queue.limit_counts):
		return false
	game_log.emit("⚡ %s: %s aktiválva!" % [unit.card.card_name, ab.ability_name])
	ability_queue.dispatch_event("ACTIVATED", {"played_card": unit.card, "played_unit": unit, "event_source_owner": 0})
	return true

## Resolve an ability target definition to a runtime value (zone array, unit, etc.)
func _resolve_ability_target(tgt, context: Dictionary = {}) -> Variant:
	var tt: String = tgt.target_type if tgt.get("target_type") else ""
	var own: String = tgt.owner if tgt.get("owner") else "Ally"

	# If target has a trigger_interactor ref, resolve from context
	var ti: String = tgt.trigger_interactor if tgt.get("trigger_interactor") else ""
	if ti != "":
		return context.get(ti, context.get(ti.to_snake_case(), null))

	match tt:
		"Graveyard":
			if own == "Enemy":
				return _enemy_zone_cards(enemy_discard_ids)
			return player_discard
		"SideDeck":
			return player_side_deck
		"Deck":
			if own == "Enemy":
				return _enemy_zone_cards(enemy_deck_ids)
			return player_deck
		"Hand":
			if own == "Enemy":
				return _enemy_zone_cards(enemy_hand_ids)
			return player_hand
		"Pile":
			if own == "Enemy":
				return _enemy_zone_cards(enemy_pile_ids)
			return player_pile
		"Unit", "Entity":
			# Check for "Self" targeting (e.g. Bárkakedvenc buffing itself on attack)
			var targeting: String = tgt.targeting if tgt.get("targeting") else ""
			if targeting == "Self":
				if context.has("played_unit"):
					return context["played_unit"]
				if context.has("attacker"):
					return context["attacker"]
				return null
			# Board targets resolved by _execute_spell targeting UI
			if context.has("initial_target"):
				return context["initial_target"]
			return null
		"Player":
			if own == "Enemy":
				return 1
			elif own == "Ally":
				return 0
			if context.has("initial_target"):
				return context["initial_target"]
			return null
		"Card":
			if context.has("played_card"):
				return context["played_card"]
			return null
	return null

func _enemy_zone_cards(id_array: Array) -> Array:
	var cards: Array = []
	for cid in id_array:
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			cards.append(card)
	return cards

## Clean up global modifiers that have expired
func _cleanup_global_modifiers(phase: String) -> void:
	for i in range(global_modifiers.size() - 1, -1, -1):
		if global_modifiers[i].is_expired(turn_number, phase):
			global_modifiers.remove_at(i)

## Clean up modifiers on all units
func _cleanup_unit_modifiers(phase: String) -> void:
	for row in range(GRID_ROWS):
		for col in range(GRID_COLS):
			var unit = grid[row][col]
			if unit:
				unit.cleanup_expired_modifiers(turn_number, phase)

## Calculate effective cost using new modifier system
func _get_effective_cost_with_modifiers(card) -> int:
	var cost: int = card.cost
	# Check global modifiers
	for mod in global_modifiers:
		if mod.modifier_type == ModifierScript.ModifierType.COST:
			if mod.scope_filter == "next_card":
				cost += mod.value
			elif mod.scope_filter == "next_unit" and card.card_type == CardScript.CardType.UNIT:
				cost += mod.value
			elif mod.scope_filter == "next_spell" and card.card_type == CardScript.CardType.SPELL:
				cost += mod.value
			elif mod.scope_filter == "type:UNIT" and card.card_type == CardScript.CardType.UNIT:
				if mod.target_player == 0:  # affects me
					cost += mod.value
			elif mod.scope_filter == "type:SPELL" and card.card_type == CardScript.CardType.SPELL:
				cost += mod.value
			elif mod.scope_filter == "":
				cost += mod.value
			elif mod.scope_filter == "source:robbery" and card.get("tags") is Array and "stolen" in card.tags:
				cost += mod.value
	# Legacy modifiers (keep during migration)
	if _next_card_cost_modifier != 0:
		cost += _next_card_cost_modifier
	if _my_unit_cost_increase != 0 and card.card_type == CardScript.CardType.UNIT:
		cost += _my_unit_cost_increase
	return maxi(0, cost)

## ===========================
## CARD DRAW
## ===========================

func _draw_card() -> void:
	if player_deck.size() == 0:
		game_log.emit("A pakli elfogyott!")
		return
	if player_hand.size() >= 10:
		game_log.emit("A kezed tele van! (10 lap)")
		return
	var card = player_deck.pop_back()
	player_hand.append(card)
	card_drawn.emit(card)
	hand_updated.emit()
	game_log.emit("Húztál: %s" % card.card_name)

func draw_cards(count: int) -> void:
	for i in range(count):
		_draw_card()

## ===========================
## PLAYING CARDS
## ===========================

func can_play_card(hand_index: int) -> bool:
	if hand_index < 0 or hand_index >= player_hand.size():
		return false
	var card := player_hand[hand_index]
	var effective_cost := _get_effective_cost(card)
	return player_mana >= effective_cost

## Calculate effective cost of a card considering all modifiers
func _get_effective_cost(card) -> int:
	var cost: int = card.cost
	# Check global modifiers (SET_COST_MODIFIER step results)
	for mod in global_modifiers:
		if mod.modifier_type == ModifierScript.ModifierType.COST:
			if mod.scope_filter == "next_card":
				cost += mod.value
			elif mod.scope_filter == "next_unit" and card.card_type == CardScript.CardType.UNIT:
				cost += mod.value
			elif mod.scope_filter == "next_spell" and card.card_type == CardScript.CardType.SPELL:
				cost += mod.value
			elif mod.scope_filter == "type:UNIT" and card.card_type == CardScript.CardType.UNIT and mod.target_player == 0:
				cost += mod.value
			elif mod.scope_filter == "type:SPELL" and card.card_type == CardScript.CardType.SPELL:
				cost += mod.value
			elif mod.scope_filter == "" and mod.target_player == 0:
				cost += mod.value
			elif mod.scope_filter == "source:robbery" and card.get("tags") is Array and "stolen" in card.tags:
				cost += mod.value
	# Legacy modifiers (keep during migration)
	if _next_card_cost_modifier != 0:
		cost += _next_card_cost_modifier
	# Határzár: unit cost increase (from opponent's Határzár affecting us)
	if _my_unit_cost_increase != 0 and card.card_type == CardScript.CardType.UNIT:
		cost += _my_unit_cost_increase
	return maxi(0, cost)

func get_hand_card_effective_cost(hand_index: int) -> int:
	if hand_index < 0 or hand_index >= player_hand.size():
		return 0
	var card := player_hand[hand_index]
	return _get_effective_cost(card)

## Consume the "next card" modifier after playing a card
func _consume_next_card_modifier(card, effective_cost: int) -> void:
	if _next_card_cost_modifier != 0:
		var saved: int = card.cost - effective_cost
		if saved > 0:
			game_log.emit("⚡ Gyorshitel: -%d költség! (Eredeti: %d → %d)" % [saved, card.cost, effective_cost])
		_next_card_cost_modifier = 0
	# Also consume global "next_card" / "next_unit" / "next_spell" cost modifiers
	var had_global_next := false
	var had_global_next_unit := false
	var had_global_next_spell := false
	for i in range(global_modifiers.size() - 1, -1, -1):
		var mod = global_modifiers[i]
		if mod.modifier_type != ModifierScript.ModifierType.COST:
			continue
		if mod.scope_filter == "next_card":
			var saved_next: int = absi(mod.value)
			if saved_next > 0 and not had_global_next:
				game_log.emit("⚡ Gyorshitel: -%d költség! (Eredeti: %d → %d)" % [saved_next, card.cost, effective_cost])
			had_global_next = true
			global_modifiers.remove_at(i)
		elif mod.scope_filter == "next_unit" and card.card_type == CardScript.CardType.UNIT:
			var saved_unit: int = absi(mod.value)
			if saved_unit > 0 and not had_global_next_unit:
				game_log.emit("⚫ Sírrablás: -%d költség! (Eredeti: %d → %d)" % [saved_unit, card.cost, effective_cost])
			had_global_next_unit = true
			global_modifiers.remove_at(i)
		elif mod.scope_filter == "next_spell" and card.card_type == CardScript.CardType.SPELL:
			var saved_spell: int = absi(mod.value)
			if saved_spell > 0 and not had_global_next_spell:
				game_log.emit("🔥 Tűz kedvezmény: -%d költség! (Eredeti: %d → %d)" % [saved_spell, card.cost, effective_cost])
			had_global_next_spell = true
			global_modifiers.remove_at(i)

func _consume_next_spell_damage_bonus(card) -> int:
	if card == null or card.card_type != CardScript.CardType.SPELL:
		return 0
	var bonus: int = 0
	for i in range(global_modifiers.size() - 1, -1, -1):
		var mod = global_modifiers[i]
		if mod.modifier_type == ModifierScript.ModifierType.DAMAGE and mod.scope_filter == "next_spell":
			bonus += mod.value
			global_modifiers.remove_at(i)
	return bonus

func can_play_card_with_modifiers(hand_index: int) -> bool:
	## Checks if a card could be played considering character cost modifiers.
	if hand_index < 0 or hand_index >= player_hand.size():
		return false
	var card := player_hand[hand_index]
	if player_mana >= _get_effective_cost(card):
		return true
	# Check if character has cost-reduction abilities for this card's school
	if card.card_type == CardScript.CardType.SPELL:
		var card_school: String = card.school if card.get("school") else ""
		for character in player_characters:
			for ab in character.abilities:
				if ab.trigger != null and ab.trigger.event == "ON_PLAY":
					# Check school_tag must match (Explodus only for Tűz)
					if ab.school_tag != "" and ab.school_tag != card_school:
						continue
					# Look for CHOOSE_ONE step with a SET_COST_MODIFIER option
					for step in ab.steps:
						if step and step.has_flow() and step.get_flow_type() == "choose_one" and step.choices.size() > 0:
							for choice in step.choices:
								var choice_steps: Array = choice.get("effects", choice.get("steps", []))
								if choice_steps.size() > 0:
									for sub_step in choice_steps:
										if sub_step and sub_step.step == "ModifyStat" and sub_step.parameters.get("ModifiedStat") == "COST":
											var modified_cost := maxi(0, card.cost + int(sub_step.parameters.get("ModifyAmount", 0)))
											if player_mana >= modified_cost:
												return true
	return false

func play_unit(hand_index: int, row: int, col: int) -> bool:
	if not can_play_card(hand_index):
		game_log.emit("Nincs elég mana!")
		return false

	var card = player_hand[hand_index]
	if not card:
		return false

	# Check valid placement (base row or adjacent to friendly unit)
	if not _is_valid_unit_placement(row, col):
		game_log.emit("Ide nem helyezhetsz egységet!")
		return false

	if grid[row][col] != null:
		game_log.emit("Ez a mező foglalt!")
		return false

	# Pay effective cost
	var effective_cost := _get_effective_cost(card)
	player_mana -= effective_cost
	_consume_next_card_modifier(card, effective_cost)

	# Place unit
	var unit = UnitInstanceScript.new(card, 0)
	unit.grid_row = row
	unit.grid_col = col
	grid[row][col] = unit

	# Remove from hand
	player_hand.remove_at(hand_index)
	hand_updated.emit()
	card_played.emit(card, row, col)
	game_log.emit("%s kijátszva a(z) %s mezőre! (Mana: %d/%d)" % [
		card.card_name, _cell_label(row, col), player_mana, player_max_mana])

	# Trigger ON_PLAY abilities via ability queue.
	# The queue collects SELF + ALLY + CHARACTER watchers automatically.
	var ctx_dict := {"played_card": card, "played_unit": unit, "event_source_owner": 0}
	ability_queue.dispatch_event("ON_PLAY", ctx_dict, func() -> void:
		_emit_state_changed()
	)
	return true

func play_spell(hand_index: int) -> bool:
	## For spells that need a target, this starts the targeting flow.
	var card = player_hand[hand_index]
	if not card:
		return false

	# Check character abilities that modify spells (e.g. Explodus ON_SPELL_PLAYED)
	# These are pre-cast modifiers, not normal triggers — run them before the spell.
	for character in player_characters:
		var card_school: String = card.school if card.get("school") else ""
		if card_school != "":
			for ab in character.abilities:
				if ab.trigger != null and ab.trigger.event == "ON_PLAY" and ab.get("school_tag") == card_school:
					if ab.steps.size() > 0:
						var spell_idx := hand_index
						var char_ctx := {"played_card": card, "event_source_owner": 0}
						ability_queue.dispatch_event("ON_PLAY", char_ctx, func() -> void:
							if not can_play_card(spell_idx):
								game_log.emit("Nincs elég mana!")
								return
							_execute_spell(spell_idx, 0, 0)
						)
						ability_triggered.emit(ab, character)
						game_log.emit("⚡ %s képessége aktiválódott! Válassz!" % character.get_full_name())
						return true

	# No character modifier — check mana normally
	if not can_play_card(hand_index):
		game_log.emit("Nincs elég mana!")
		return false
	_execute_spell(hand_index, 0, 0)
	return true

func _execute_spell(hand_index: int, cost_modifier: int, damage_bonus: int) -> void:
	if hand_index < 0 or hand_index >= player_hand.size():
		return
	var card = player_hand[hand_index]
	if not card:
		return

	# Calculate effective cost: base + character modifier + Gyorshitel + Határzár
	var effective := _get_effective_cost(card)
	var final_cost := maxi(0, effective + cost_modifier)
	if player_mana < final_cost:
		game_log.emit("Nincs elég mana! (Költség: %d)" % final_cost)
		return
	var applied_damage_bonus: int = damage_bonus + _consume_next_spell_damage_bonus(card)

	# Determine if the spell needs a board target (UNIT/ENTITY/TILE/AREA)
	var needs_board_target := false
	var target_ability = null
	for ab in card.abilities:
		if ab and ab.targeting_mode == TM.PLAYER_CHOICE:
			match ab.valid_target_1:
				VT1.UNIT, \
				VT1.ENTITY, \
				VT1.TILE, \
				VT1.AREA:
					needs_board_target = true
					target_ability = ab
					break

	if needs_board_target and target_ability:
		# Request board target selection — cost paid inside callback after target is chosen
		_awaiting_target = true
		_target_valid = target_ability.valid_target_1
		_target_valid_2 = target_ability.valid_target_2
		_target_valid_3 = target_ability.valid_target_3
		_target_range = target_ability.effect_range
		_target_source_row = player_base_row
		_target_source_col = 2
		_target_callback = func(row: int, col: int) -> void:
			_awaiting_target = false
			player_mana -= final_cost
			_consume_next_card_modifier(card, final_cost)
			player_hand.remove_at(hand_index)
			hand_updated.emit()
			_steal_spell_card = card
			var target_ref = null
			if row == -1 and col == -1:
				target_ref = 1
			elif row == -2 and col == -2:
				target_ref = 0
			else:
				target_ref = grid[row][col] if row >= 0 and row < GRID_ROWS and col >= 0 and col < GRID_COLS else null
			var ctx_dict := {"played_card": card, "initial_target": target_ref, "initial_row": row, "initial_col": col, "damage_bonus": applied_damage_bonus, "event_source_owner": 0}
			ability_queue.dispatch_event("ON_PLAY", ctx_dict, func() -> void:
				player_pile.append(card)
				card_played.emit(card, row, col)
				game_log.emit("%s kijátszva! (Mana: %d/%d)" % [card.card_name, player_mana, player_max_mana])
				_emit_state_changed()
			)

		target_requested.emit(_target_valid, _target_range, _target_source_row, _target_source_col, _target_callback)
		if cost_modifier < 0:
			game_log.emit("🔥 Tűz kedvezmény! Költség: %d (-%d)" % [final_cost, absi(cost_modifier)])
		if applied_damage_bonus > 0:
			game_log.emit("🔥 Tűz erősítés! +%d sebzés" % applied_damage_bonus)
		game_log.emit("Válassz célpontot %s számára! (Hatótáv: %d)" % [card.card_name, target_ability.effect_range])
	else:
		# No board target needed — pay cost and resolve abilities immediately
		player_mana -= final_cost
		_consume_next_card_modifier(card, final_cost)
		player_hand.remove_at(hand_index)
		hand_updated.emit()
		_steal_spell_card = card
		var ctx_dict := {"played_card": card, "damage_bonus": applied_damage_bonus, "event_source_owner": 0}
		ability_queue.dispatch_event("ON_PLAY", ctx_dict, func() -> void:
			player_pile.append(card)
			card_played.emit(card, -1, -1)
			game_log.emit("%s kijátszva! (Mana: %d/%d)" % [card.card_name, player_mana, player_max_mana])
			_emit_state_changed()
		)

func _check_card_valid_target_filter(card, filter: String, source_card = null) -> bool:
	if filter.is_empty():
		return true
	for part in filter.split(","):
		var f := part.strip_edges()
		if f.is_empty():
			continue
		if f.begins_with("tag:"):
			var tag := f.substr(4)
			if not (card.get("tags") and tag in card.tags):
				return false
		elif f.begins_with("cost<"):
			var val := f.substr(5)
			if val == "SELF" and source_card != null:
				if card.cost >= source_card.cost:
					return false
			elif val.is_valid_int():
				if card.cost >= int(val):
					return false
		elif f.begins_with("cost="):
			var val_eq := f.substr(5)
			if val_eq.is_valid_int() and card.cost != int(val_eq):
				return false
	return true

func _kill_unit(row: int, col: int, killer = null) -> void:
	var unit = grid[row][col]
	if unit:
		game_log.emit("💀 %s meghalt! (%s)" % [unit.get_display_name(), _cell_label(row, col)])

		# Remove from grid immediately to prevent double-targeting
		var killed_unit = unit
		grid[row][col] = null

		# Dead units go to temető (discard) — only player units tracked
		if unit.owner_id == 0:
			player_discard.append(unit.card)
		else:
			enemy_discard_ids.append(int(unit.card.card_id))
		# Clear named card reference
		var pos_key := "%d,%d" % [row, col]
		_named_cards.erase(pos_key)
		unit_died.emit(killed_unit)

		# Process attached cards (weapons, enchantments) — execute detach steps
		_process_detach_steps(killed_unit, func() -> void:
			# Trigger ON_DEATH abilities via ability queue, then check killer abilities
			var death_ctx := {"killed_unit": killed_unit, "played_card": unit.card, "event_source_owner": unit.owner_id}
			game_log.emit("DEATH: %s" % unit.card.card_name)
			ability_queue.dispatch_event("ON_DEATH", death_ctx, func() -> void:
				# Check killer's ON_KILL abilities (only if killer survived)
				if killer and killer.is_alive():
					var kill_ctx := {"killed_unit": killed_unit, "killer": killer, "event_source_owner": killer.owner_id}
					ability_queue.dispatch_event("ON_KILL", kill_ctx, func() -> void:
						_emit_state_changed()
					)
				elif killer:
					# Character ON_ALLY_KILL abilities trigger even if the killer died
					var kill_ctx2 := {"killed_unit": killed_unit, "killer": killer, "event_source_owner": killer.owner_id}
					ability_queue.dispatch_event("ON_KILL", kill_ctx2, func() -> void:
						_emit_state_changed()
					)
				else:
					_emit_state_changed()
			)
		)

func _process_detach_steps(killed_unit, callback: Callable) -> void:
	var attachments: Array = killed_unit.attached_cards.duplicate()
	killed_unit.attached_cards.clear()
	if attachments.is_empty():
		if callback.is_valid():
			callback.call()
		return
	_process_detach_seq(attachments, 0, killed_unit, callback)

func _process_detach_seq(attachments: Array, index: int, killed_unit, callback: Callable) -> void:
	if index >= attachments.size():
		if callback.is_valid():
			callback.call()
		return
	var attachment: Dictionary = attachments[index]
	var detach_steps: Array = attachment.get("detach_steps", [])
	var source_card = attachment.get("source_card", null)
	var card_name: String = attachment.get("card_name", "?")
	if detach_steps.is_empty():
		_process_detach_seq(attachments, index + 1, killed_unit, callback)
		return
	game_log.emit("⚔ %s leválik: %s" % [card_name, killed_unit.get_display_name()])
	var pipe := EffectPipelineScript.new()
	pipe.source_unit = killed_unit
	pipe.source_card = source_card
	pipe.owner_id = killed_unit.owner_id
	executor.execute_chain(detach_steps.duplicate(), pipe, func() -> void:
		_process_detach_seq(attachments, index + 1, killed_unit, callback)
	)

## ===========================
## ENEMY HP
## ===========================

func _damage_enemy_player(amount: int) -> void:
	enemy_hp -= amount
	game_log.emit("💥 Az ellenfél kap %d sebzést! (HP: %d)" % [amount, enemy_hp])
	if enemy_hp <= 0:
		enemy_hp = 0
		game_log.emit("🏆 Az ellenfél életpontjai elfogytak! GYŐZELEM!")
		game_won.emit()

func _damage_player(amount: int) -> void:
	player_hp -= amount
	player_hp_changed.emit(0, player_hp)
	game_log.emit("💥 A játékos kap %d sebzést! (HP: %d)" % [amount, player_hp])
	if player_hp <= 0:
		player_hp = 0
		game_log.emit("☠ Az életpontjaid elfogytak! VERESÉG!")
		game_lost.emit()

## ===========================
## TARGET SELECTION (called from UI)
## ===========================

func submit_target(row: int, col: int) -> bool:
	if not _awaiting_target:
		return false

	# If a valid tile override is active (e.g. summon/constrained placement),
	# only accept tiles in the override list.
	if _valid_tile_override.size() > 0:
		var pos := Vector2i(row, col)
		if pos not in _valid_tile_override:
			game_log.emit("Érvénytelen mező!")
			return false

	# Validate range
	if _target_range > 0:
		if _target_use_source:
			var dist := absi(row - _target_source_row) + absi(col - _target_source_col)
			if dist > _target_range:
				game_log.emit("Hatótávon kívül!")
				return false
		elif not _is_tile_in_spell_range(row, col, _target_range):
			game_log.emit("Hatótávon kívül!")
			return false

	# Validate target type
	var target_unit = grid[row][col]
	match _target_valid:
		VT1.ENTITY:
			if not target_unit:
				game_log.emit("Érvénytelen célpont! Egységet vagy játékost válassz!")
				return false
			if not _check_alignment(target_unit):
				game_log.emit("Érvénytelen célpont! Rossz oldal!")
				return false
		VT1.UNIT:
			if not target_unit:
				game_log.emit("Érvénytelen célpont! Egységet válassz!")
				return false
			if not _check_alignment(target_unit):
				match _target_valid_2:
					VT2.ALLY:
						game_log.emit("Érvénytelen célpont! Szövetséges egységet válassz!")
					VT2.ENEMY:
						game_log.emit("Érvénytelen célpont! Ellenséges egységet válassz!")
					_:
						game_log.emit("Érvénytelen célpont!")
				return false
			if not _check_target_filter(target_unit):
				game_log.emit("Érvénytelen célpont! A célpont nem felel meg a feltételeknek!")
				return false
		VT1.TILE:
			if target_unit:
				game_log.emit("Érvénytelen célpont! Üres mezőt válassz!")
				return false
		_:
			pass

	_target_callback.call(row, col)
	return true

## Submit targeting the enemy player directly with a spell
func submit_target_player() -> bool:
	if not _awaiting_target:
		return false
	if _target_range > 0:
		if _target_use_source:
			var dist_to_enemy_player: int = absi(_target_source_row - enemy_base_row) + 1
			if dist_to_enemy_player > _target_range:
				game_log.emit("Hatótávon kívül!")
				return false
		elif not _is_enemy_player_in_spell_range(_target_range):
			game_log.emit("Hatótávon kívül!")
			return false
	# Only allow targeting enemy player with spells that can target enemies
	# Treat empty valid_target_2 as ANY
	var effective_vt2: String = _target_valid_2 if _target_valid_2 != "" else VT2.ANY
	var can_target := false
	match _target_valid:
		VT1.ENTITY, VT1.PLAYER:
			if effective_vt2 == VT2.ENEMY or effective_vt2 == VT2.ANY:
				can_target = true
		VT1.UNIT, VT1.TILE, VT1.AREA:
			if effective_vt2 == VT2.ENEMY or effective_vt2 == VT2.ANY:
				can_target = true
	if not can_target:
		game_log.emit("Ez a varázslat nem célozhatja a játékost!")
		return false
	# Resolve as direct player damage
	_awaiting_target = false
	# We need the card info from the callback closure — call it on a sentinel tile (-1, -1)
	_target_callback.call(-1, -1)
	return true

func can_target_enemy_player(valid_target_1: String, valid_target_2: String, range_val: int) -> bool:
	# Treat empty valid_target_2 as ANY
	var effective_vt2: String = valid_target_2 if valid_target_2 != "" else VT2.ANY
	match valid_target_1:
		VT1.ENTITY, VT1.PLAYER, VT1.UNIT, VT1.TILE, VT1.AREA:
			if effective_vt2 == VT2.ENEMY or effective_vt2 == VT2.ANY:
				return _is_enemy_player_in_spell_range(range_val)
			return false
		_:
			return false

## Submit targeting the player themselves (self) with a spell
func submit_target_self_player() -> bool:
	if not _awaiting_target:
		return false
	if not _is_self_player_in_spell_range(_target_range):
		game_log.emit("Hatótávon kívül!")
		return false
	# Treat empty valid_target_2 as ANY
	var effective_vt2: String = _target_valid_2 if _target_valid_2 != "" else VT2.ANY
	match _target_valid:
		VT1.ENTITY, VT1.PLAYER:
			if effective_vt2 == VT2.ALLY or effective_vt2 == VT2.ANY:
				pass
			else:
				game_log.emit("Ez a varázslat nem célozhatja magadat!")
				return false
		_:
			game_log.emit("Ez a varázslat nem célozhatja magadat!")
			return false
	_awaiting_target = false
	# Sentinel (-2, -2) means target is the self player
	_target_callback.call(-2, -2)
	return true

func can_target_self_player(valid_target_1: String, valid_target_2: String, range_val: int) -> bool:
	# Treat empty valid_target_2 as ANY
	var effective_vt2: String = valid_target_2 if valid_target_2 != "" else VT2.ANY
	match valid_target_1:
		VT1.ENTITY, VT1.PLAYER:
			if effective_vt2 == VT2.ALLY or effective_vt2 == VT2.ANY:
				return _is_self_player_in_spell_range(range_val)
			return false
		_:
			return false

func submit_choice(choice_index: int) -> void:
	if not _awaiting_choice:
		return
	_choice_callback.call(choice_index)

func is_awaiting_target() -> bool:
	return _awaiting_target

func is_awaiting_choice() -> bool:
	return _awaiting_choice

func cancel_target() -> void:
	_awaiting_target = false
	_awaiting_hand_card = false
	_mobilize_remaining = 0
	game_log.emit("Célpont kiválasztás megszakítva.")

func cancel_choice() -> void:
	_awaiting_choice = false
	game_log.emit("Választás megszakítva.")

func is_awaiting_hand_card() -> bool:
	return _awaiting_hand_card

func get_hand_card_valid_indices() -> Array:
	return _hand_card_valid_indices

func submit_hand_card(hand_index: int) -> bool:
	if not _awaiting_hand_card:
		return false
	if hand_index < 0 or hand_index >= player_hand.size():
		return false
	if hand_index not in _hand_card_valid_indices:
		game_log.emit("Ez a lap nem érvényes célpont!")
		return false
	_awaiting_hand_card = false
	_hand_card_callback.call(hand_index)
	return true

func skip_hand_card_selection() -> void:
	## Player chooses to stop selecting cards (e.g. after 0 or 1 selections)
	_awaiting_hand_card = false
	_mobilize_remaining = 0
	game_log.emit("Mozgósítás befejezve.")
	_emit_state_changed()

## --- Discard from hand selection (Lomtalanítás, Bolyongó) ---
func is_awaiting_discard_from_hand() -> bool:
	return _awaiting_discard_from_hand

func submit_discard_from_hand(hand_index: int) -> bool:
	if not _awaiting_discard_from_hand:
		return false
	if hand_index < 0 or hand_index >= player_hand.size():
		return false
	_awaiting_discard_from_hand = false
	_discard_hand_callback.call(hand_index)
	return true

## --- Mozgósítás multi-step flow ---
func _execute_mobilize_step() -> void:
	if _mobilize_remaining <= 0:
		game_log.emit("⚡ Mozgósítás befejezve!")
		_emit_state_changed()
		return

	# Find valid hand cards (cost=1 units for Mozgósítás)
	var valid_indices: Array = []
	for i in range(player_hand.size()):
		var c = player_hand[i]
		if c and c.card_type == CardScript.CardType.UNIT and c.cost <= 1:
			valid_indices.append(i)

	if valid_indices.is_empty():
		game_log.emit("⚡ Mozgósítás: Nincs több érvényes egység a kezedben!")
		_mobilize_remaining = 0
		_emit_state_changed()
		return

	# Check if there are valid placement tiles
	var placement_tiles := get_valid_placement_tiles()
	if placement_tiles.is_empty():
		game_log.emit("⚡ Mozgósítás: Nincs szabad hely az egységeknek!")
		_mobilize_remaining = 0
		_emit_state_changed()
		return

	_awaiting_hand_card = true
	_hand_card_valid_indices = valid_indices
	_hand_card_callback = func(selected_index: int) -> void:
		if selected_index < 0 or selected_index >= player_hand.size():
			return
		var selected_card = player_hand[selected_index]
		# Now request tile selection for placement
		_awaiting_target = true
		_target_valid = VT1.TILE
		_target_valid_2 = VT2.ANY
		_target_valid_3 = ""
		_target_range = 0
		_target_source_row = -1
		_target_source_col = -1
		_target_use_source = false
		var sel_idx := selected_index
		var sel_card = selected_card
		_target_callback = func(row: int, col: int) -> void:
			_awaiting_target = false
			if not _is_valid_unit_placement(row, col) or grid[row][col] != null:
				game_log.emit("Érvénytelen lehelyezési mező!")
				return
			# Place unit without paying mana
			var unit = UnitInstanceScript.new(sel_card, 0)
			unit.grid_row = row
			unit.grid_col = col
			grid[row][col] = unit
			player_hand.remove_at(sel_idx)
			hand_updated.emit()
			card_played.emit(sel_card, row, col)
			var mob_ctx := {"played_card": sel_card, "played_unit": unit, "event_source_owner": 0}
			ability_queue.dispatch_event("ON_PLAY", mob_ctx, func() -> void:
				game_log.emit("⚡ Mozgósítás: %s kijátszva a(z) %s mezőre!" % [sel_card.card_name, _cell_label(row, col)])
				_mobilize_remaining -= 1
				_execute_mobilize_step()
			)
		target_requested.emit(_target_valid, _target_range, _target_source_row, _target_source_col, _target_callback)
		game_log.emit("Válassz mezőt %s lehelyezéséhez!" % selected_card.card_name)

	hand_card_target_requested.emit(valid_indices, _hand_card_callback)
	game_log.emit("⚡ Mozgósítás: Válassz egységet a kezedből! (Hátralevő: %d)" % _mobilize_remaining)

## ===========================
## PLACEMENT VALIDATION
## ===========================

func _is_valid_unit_placement(row: int, col: int) -> bool:
	if row == player_base_row:
		return true
	for dir in [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]:
		var nr: int = row + dir.x
		var nc: int = col + dir.y
		if nr >= 0 and nr < GRID_ROWS and nc >= 0 and nc < GRID_COLS:
			var adj_unit = grid[nr][nc]
			if adj_unit and adj_unit.owner_id == 0:
				return true
	return false

func get_valid_placement_tiles() -> Array:
	var tiles: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			if grid[r][c] == null and _is_valid_unit_placement(r, c):
				tiles.append(Vector2i(r, c))
	return tiles

## ===========================
## HELPERS
## ===========================

func _cell_label(row: int, col: int) -> String:
	return "%s%d" % ["ABCDE"[col], row + 1]

func get_unit_at(row: int, col: int):
	if row >= 0 and row < GRID_ROWS and col >= 0 and col < GRID_COLS:
		return grid[row][col]
	return null

## ===========================
## TARGETING HELPERS (ValidTarget1/2/3)
## ===========================

## Check if a unit matches the current _target_valid_2 alignment
func _check_alignment(unit) -> bool:
	var effective_vt2: String = _target_valid_2 if _target_valid_2 != "" else VT2.ANY
	return _check_alignment_for(unit, effective_vt2)

## Check if a unit matches a specific alignment value
func _check_alignment_for(unit, alignment: String) -> bool:
	match alignment:
		VT2.ALLY:
			return unit.owner_id == 0
		VT2.ENEMY:
			return unit.owner_id != 0
		_:  # ANY
			return true

## Check if a unit passes the ValidTarget3 filter condition
## When called with 1 arg, uses the state var _target_valid_3 (targeting flow).
## When called with explicit filter_str and source, uses those directly (aura/trigger checks).
func _check_target_filter(unit, filter_str: String = "", source = null) -> bool:
	var filter := filter_str if filter_str != "" else _target_valid_3
	if filter.is_empty():
		return true
	# Support comma-separated filters (all must pass)
	if "," in filter:
		for part in filter.split(","):
			if not _check_single_filter(unit, part.strip_edges(), source):
				return false
		return true
	return _check_single_filter(unit, filter, source)

func _check_single_filter(unit, filter: String, source) -> bool:
	if filter.is_empty():
		return true
	if filter.begins_with("cost<"):
		var val_str := filter.substr(5)
		if val_str == "SELF":
			if source != null and source.get("card"):
				return unit.card.cost < source.card.cost
			return unit.card.cost < _command_cost_limit
		elif val_str.is_valid_int():
			return unit.card.cost < int(val_str)
	elif filter.begins_with("cost="):
		var val_str := filter.substr(5)
		if val_str.is_valid_int():
			return unit.card.cost == int(val_str)
	elif filter.begins_with("tag:"):
		var tag := filter.substr(4)
		return unit.card.get("tags") and tag in unit.card.tags
	elif filter.begins_with("has_ability:"):
		var trigger_type := filter.substr(12)
		for ab in unit.card.abilities:
			if ab.trigger != null and ab.trigger.event == trigger_type:
				return true
		return false
	elif filter == "damaged":
		return unit.is_damaged() if unit.has_method("is_damaged") else (unit.get("current_hp") != null and unit.card != null and unit.current_hp < unit.card.hp)
	# Unknown filter — pass by default
	return true

## ===========================
## SPELL RANGE
## ===========================

func _is_tile_in_spell_range(row: int, col: int, range_val: int) -> bool:
	if range_val <= 0:
		return true
	var base_dist: int = absi(row - player_base_row) + 1
	if base_dist >= 1 and base_dist <= range_val:
		return true
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var u = grid[r][c]
			if u and u.owner_id == 0:
				var dist: int = absi(row - r) + absi(col - c)
				if dist <= range_val:
					return true
	return false

func _is_enemy_player_in_spell_range(range_val: int) -> bool:
	if range_val <= 0:
		return true
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var u = grid[r][c]
			if u and u.owner_id == 0:
				var dist_to_enemy_player: int = absi(r - enemy_base_row) + 1
				if dist_to_enemy_player <= range_val:
					return true
	return false

func _is_self_player_in_spell_range(range_val: int) -> bool:
	## Self-player is always in range (range from your own base is always 1)
	if range_val <= 0:
		return true
	# Distance from own base to self = 1
	return range_val >= 1

func get_valid_spell_tiles(range_val: int, valid_target_1: String, valid_target_2: String = "ANY") -> Array:
	# Treat empty valid_target_2 as ANY
	var effective_vt2: String = valid_target_2 if valid_target_2 != "" else VT2.ANY
	var tiles: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			if not _is_tile_in_spell_range(r, c, range_val):
				continue
			var u = grid[r][c]
			match valid_target_1:
				VT1.ENTITY:
					if u and _check_alignment_for(u, effective_vt2):
						tiles.append(Vector2i(r, c))
				VT1.UNIT:
					if u and _check_alignment_for(u, effective_vt2):
						tiles.append(Vector2i(r, c))
				VT1.TILE:
					if not u:
						tiles.append(Vector2i(r, c))
				_:
					tiles.append(Vector2i(r, c))
	return tiles

## ===========================
## UNIT MOVEMENT
## ===========================

func get_valid_move_targets(row: int, col: int) -> Array:
	var unit = grid[row][col]
	if not unit or unit.moves_remaining <= 0 or unit.owner_id != 0:
		return []
	if unit.card and unit.card.card_type == CardScript.CardType.BUILDING:
		return []
	var speed: int = unit.moves_remaining
	var visited: Dictionary = {}
	var queue: Array = []
	queue.append(Vector3i(row, col, 0))
	visited[Vector2i(row, col)] = true
	var targets: Array = []
	while queue.size() > 0:
		var cur: Vector3i = queue.pop_front()
		var cr: int = cur.x
		var cc: int = cur.y
		var cd: int = cur.z
		if cd > 0 and grid[cr][cc] == null:
			targets.append(Vector2i(cr, cc))
		if cd < speed:
			for dir in [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]:
				var nr: int = cr + dir.x
				var nc: int = cc + dir.y
				var pos := Vector2i(nr, nc)
				if nr >= 0 and nr < GRID_ROWS and nc >= 0 and nc < GRID_COLS and not visited.has(pos):
					visited[pos] = true
					if grid[nr][nc] == null:
						queue.append(Vector3i(nr, nc, cd + 1))
	return targets

func move_unit(from_row: int, from_col: int, to_row: int, to_col: int) -> bool:
	var unit = grid[from_row][from_col]
	if not unit or unit.owner_id != 0 or unit.moves_remaining <= 0:
		game_log.emit("Ez az egység nem mozoghat!")
		return false
	if unit.card and unit.card.card_type == CardScript.CardType.BUILDING:
		game_log.emit("Az épületek nem mozoghatnak!")
		return false
	if grid[to_row][to_col] != null:
		game_log.emit("A célmező foglalt!")
		return false
	var valid_targets := get_valid_move_targets(from_row, from_col)
	var target_pos := Vector2i(to_row, to_col)
	var found := false
	for vt in valid_targets:
		if vt == target_pos:
			found = true
			break
	if not found:
		game_log.emit("Érvénytelen mozgási cél!")
		return false
	# Compute BFS distance to deduct from moves_remaining
	var move_dist := _get_move_distance(from_row, from_col, to_row, to_col)
	grid[from_row][from_col] = null
	grid[to_row][to_col] = unit
	unit.grid_row = to_row
	unit.grid_col = to_col
	unit.moves_remaining = maxi(0, unit.moves_remaining - move_dist)
	unit.has_moved = (unit.moves_remaining <= 0)
	_update_weapon_position(from_row, from_col, to_row, to_col)
	game_log.emit("🏃 %s: %s → %s (Lépés: %d/%d)" % [unit.get_display_name(), _cell_label(from_row, from_col), _cell_label(to_row, to_col), move_dist, unit.moves_remaining + move_dist])
	return true

## BFS distance between two tiles (through empty tiles)
func _get_move_distance(from_row: int, from_col: int, to_row: int, to_col: int) -> int:
	if from_row == to_row and from_col == to_col:
		return 0
	var visited: Dictionary = {}
	var queue: Array = []
	queue.append(Vector3i(from_row, from_col, 0))
	visited[Vector2i(from_row, from_col)] = true
	while queue.size() > 0:
		var cur: Vector3i = queue.pop_front()
		for dir in [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]:
			var nr: int = cur.x + dir.x
			var nc: int = cur.y + dir.y
			var pos := Vector2i(nr, nc)
			if nr >= 0 and nr < GRID_ROWS and nc >= 0 and nc < GRID_COLS and not visited.has(pos):
				visited[pos] = true
				if nr == to_row and nc == to_col:
					return cur.z + 1
				if grid[nr][nc] == null:
					queue.append(Vector3i(nr, nc, cur.z + 1))
	return 999  # Unreachable (should not happen for valid moves)

## ===========================
## UNIT COMBAT
## ===========================

func get_valid_attack_targets(row: int, col: int) -> Array:
	var unit = grid[row][col]
	if not unit or unit.has_attacked or unit.owner_id != 0:
		return []
	if unit.card and unit.card.card_type == CardScript.CardType.BUILDING:
		return []
	var atk_range: int = unit.card.attack_range if unit.card.get("attack_range") else 1
	var targets: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var target = grid[r][c]
			if target and target.owner_id != unit.owner_id:
				var dist: int = absi(row - r) + absi(col - c)
				if dist <= atk_range:
					targets.append(Vector2i(r, c))
	return targets

func can_attack_player(row: int, col: int) -> bool:
	var unit = grid[row][col]
	if not unit or unit.has_attacked or unit.owner_id != 0:
		return false
	if unit.card and unit.card.card_type == CardScript.CardType.BUILDING:
		return false
	return row == enemy_base_row  # Enemy base row

func attack_unit(atk_row: int, atk_col: int, def_row: int, def_col: int) -> bool:
	var attacker = grid[atk_row][atk_col]
	var defender = grid[def_row][def_col]
	if not attacker or not defender:
		return false
	if attacker.card and attacker.card.card_type == CardScript.CardType.BUILDING:
		game_log.emit("Az épületek nem támadhatnak!")
		return false
	if attacker.owner_id == defender.owner_id:
		return false
	if attacker.has_attacked:
		game_log.emit("%s már támadott ebben a körben!" % attacker.get_display_name())
		return false
	var valid := get_valid_attack_targets(atk_row, atk_col)
	var target_pos := Vector2i(def_row, def_col)
	var found := false
	for vt in valid:
		if vt == target_pos:
			found = true
			break
	if not found:
		game_log.emit("Hatótávon kívül!")
		return false

	attacker.has_attacked = true
	var atk_val: int = attacker.get_effective_attack()
	var def_val: int = defender.get_effective_attack()

	# Apply aura bonuses
	atk_val += get_aura_attack_bonus(attacker, atk_row, atk_col)
	def_val += get_aura_attack_bonus(defender, def_row, def_col)

	# Check ON_ATTACK abilities (e.g. Bárkakedvenc conditional buff)
	var atk_ctx := {"attacker": attacker, "played_unit": attacker, "played_card": attacker.card, "defender": defender, "target": defender, "event_source_owner": attacker.owner_id}
	ability_queue.dispatch_event("ON_ATTACK", atk_ctx)
	# Re-read attack in case ON_ATTACK modified it
	atk_val = attacker.get_effective_attack() + get_aura_attack_bonus(attacker, atk_row, atk_col)

	game_log.emit("⚔ %s (%d⚔) megtámadja %s-t (%d⚔ %d♥)!" % [
		attacker.get_display_name(), atk_val,
		defender.get_display_name(), def_val, defender.get_effective_hp()])

	var has_first_strike := _has_keyword(attacker, "Ütéselőny")
	var has_double_strike := _has_keyword(attacker, "Kettős csapás")

	if has_first_strike or has_double_strike:
		defender.take_damage(atk_val)
		unit_damaged.emit(defender, atk_val)
		game_log.emit("⚡ Ütéselőny! %s sebzi %s-t %d-vel!" % [
			attacker.get_display_name(), defender.get_display_name(), atk_val])
		if not defender.is_alive():
			_kill_unit(def_row, def_col, attacker)
			return true

	if not has_first_strike and not has_double_strike:
		defender.take_damage(atk_val)
		unit_damaged.emit(defender, atk_val)
	elif has_double_strike:
		defender.take_damage(atk_val)
		unit_damaged.emit(defender, atk_val)

	var combat_dist: int = absi(atk_row - def_row) + absi(atk_col - def_col)
	var defender_range: int = defender.card.attack_range if defender.card.get("attack_range") else 1
	if combat_dist <= defender_range:
		attacker.take_damage(def_val)
		unit_damaged.emit(attacker, def_val)
	else:
		game_log.emit("⚡ %s nem tud visszatámadni (hatótávon kívül)!" % defender.get_display_name())

	game_log.emit("⚔ Harc: %s (%s) vs %s (%s)" % [
		attacker.get_display_name(), attacker.get_stats_text(),
		defender.get_display_name(), defender.get_stats_text()])

	if not defender.is_alive():
		_kill_unit(def_row, def_col, attacker)
	if not attacker.is_alive():
		_kill_unit(atk_row, atk_col, defender)
	return true

func attack_enemy_player(row: int, col: int) -> bool:
	var unit = grid[row][col]
	if not unit or unit.owner_id != 0 or unit.has_attacked:
		return false
	if unit.card and unit.card.card_type == CardScript.CardType.BUILDING:
		return false
	if not can_attack_player(row, col):
		return false
	unit.has_attacked = true
	var dmg: int = unit.get_effective_attack()
	_damage_enemy_player(dmg)
	game_log.emit("⚔ %s közvetlenül támadja az ellenfelet %d sebzéssel!" % [unit.get_display_name(), dmg])
	return true

func _has_keyword(unit, keyword: String) -> bool:
	if unit.has_method("has_keyword"):
		return unit.has_keyword(keyword)
	if keyword in unit.keywords:
		return true
	if unit.card.get("tags") and keyword in unit.card.tags:
		return true
	return false

func _get_command_target_tiles() -> Array:
	var tiles: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var u = grid[r][c]
			if u and u.owner_id == 0 and u.card.cost < _command_cost_limit:
				tiles.append(Vector2i(r, c))
	return tiles

func _execute_command_attack(unit, cmd_row: int, cmd_col: int) -> void:
	var targets: Array = get_command_attack_targets(cmd_row, cmd_col)
	var can_hit_player: bool = can_command_attack_player(cmd_row, cmd_col)
	if targets.is_empty() and not can_hit_player:
		game_log.emit("Nincs érvényes támadási célpont a parancshoz!")
		return

	if targets.size() + (1 if can_hit_player else 0) == 1:
		if can_hit_player and targets.is_empty():
			_command_attack_player(unit, cmd_row, cmd_col)
			return
		var only_target: Vector2i = targets[0]
		_command_attack(unit, cmd_row, cmd_col, only_target.x, only_target.y)
		return

	# Request player to choose an attack target
	_awaiting_target = true
	_target_valid = VT1.UNIT
	_target_valid_2 = VT2.ENEMY
	_target_valid_3 = ""
	_target_range = unit.card.attack_range if unit.card.get("attack_range") else 1
	_target_source_row = cmd_row
	_target_source_col = cmd_col
	_target_use_source = true
	var unit_ref = unit
	var ur := cmd_row
	var uc := cmd_col
	_target_callback = func(def_row: int, def_col: int) -> void:
		_awaiting_target = false
		_target_use_source = false
		if def_row == -1 and def_col == -1:
			_command_attack_player(unit_ref, ur, uc)
		else:
			_command_attack(unit_ref, ur, uc, def_row, def_col)
	target_requested.emit(_target_valid, _target_range, _target_source_row, _target_source_col, _target_callback)
	game_log.emit("⚡ Parancs: Válassz célpontot %s támadásához!" % unit.get_display_name())

func get_command_attack_targets(row: int, col: int) -> Array:
	var unit = grid[row][col]
	if not unit:
		return []
	var atk_range: int = unit.card.attack_range if unit.card.get("attack_range") else 1
	var targets: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var target = grid[r][c]
			if target and target.owner_id != unit.owner_id:
				var dist: int = absi(row - r) + absi(col - c)
				if dist <= atk_range:
					targets.append(Vector2i(r, c))
	return targets

func can_command_attack_player(row: int, col: int) -> bool:
	var unit = grid[row][col]
	if not unit:
		return false
	var atk_range: int = unit.card.attack_range if unit.card.get("attack_range") else 1
	var dist_to_enemy_player: int = absi(row - enemy_base_row) + 1
	return dist_to_enemy_player <= atk_range

func _command_attack(attacker_unit, atk_row: int, atk_col: int, def_row: int, def_col: int) -> void:
	var defender = grid[def_row][def_col]
	if not defender:
		return
	if defender.owner_id == attacker_unit.owner_id:
		return
	var atk_val: int = attacker_unit.get_effective_attack()
	var def_val: int = defender.get_effective_attack()

	game_log.emit("⚔ Parancs! %s (%d⚔) megtámadja %s-t (%d⚔ %d♥)!" % [
		attacker_unit.get_display_name(), atk_val,
		defender.get_display_name(), def_val, defender.get_effective_hp()])

	# Combat exchange (command attacks don't use first/double strike)
	defender.take_damage(atk_val)
	unit_damaged.emit(defender, atk_val)
	attacker_unit.take_damage(def_val)
	unit_damaged.emit(attacker_unit, def_val)

	game_log.emit("⚔ Harc: %s (%s) vs %s (%s)" % [
		attacker_unit.get_display_name(), attacker_unit.get_stats_text(),
		defender.get_display_name(), defender.get_stats_text()])

	if not defender.is_alive():
		_kill_unit(def_row, def_col, attacker_unit)
	if not attacker_unit.is_alive():
		_kill_unit(atk_row, atk_col, defender)

func _command_attack_player(attacker_unit, atk_row: int, atk_col: int) -> void:
	if not can_command_attack_player(atk_row, atk_col):
		game_log.emit("A játékos nincs hatótávon belül a parancshoz.")
		return
	var atk_val: int = attacker_unit.get_effective_attack()
	_damage_enemy_player(atk_val)
	game_log.emit("⚔ Parancs! %s közvetlenül támadja az ellenfelet %d sebzéssel!" % [attacker_unit.get_display_name(), atk_val])

func _execute_command_move(unit, cmd_row: int, cmd_col: int) -> void:
	# Find valid move targets (1 tile adjacent)
	var move_range: int = 1
	var targets: Array = []
	for dir in [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]:
		var nr: int = cmd_row + dir.x
		var nc: int = cmd_col + dir.y
		if nr >= 0 and nr < GRID_ROWS and nc >= 0 and nc < GRID_COLS:
			if grid[nr][nc] == null:
				targets.append(Vector2i(nr, nc))
	if targets.is_empty():
		game_log.emit("Nincs érvényes mozgási cél a parancshoz!")
		return

	# Request player to choose a move target
	_awaiting_target = true
	_target_valid = VT1.TILE
	_target_valid_2 = VT2.ANY
	_target_valid_3 = ""
	_target_range = move_range
	_target_source_row = cmd_row
	_target_source_col = cmd_col
	_target_use_source = true
	var unit_ref = unit
	var ur := cmd_row
	var uc := cmd_col
	_target_callback = func(move_row: int, move_col: int) -> void:
		_awaiting_target = false
		_target_use_source = false
		# Move the unit (doesn't consume has_moved)
		grid[ur][uc] = null
		grid[move_row][move_col] = unit_ref
		unit_ref.grid_row = move_row
		unit_ref.grid_col = move_col
		game_log.emit("🏃 Parancs! %s: %s → %s" % [
			unit_ref.get_display_name(), _cell_label(ur, uc), _cell_label(move_row, move_col)])
	target_requested.emit(_target_valid, _target_range, _target_source_row, _target_source_col, _target_callback)
	game_log.emit("⚡ Parancs: Válassz mezőt %s mozgatásához!" % unit.get_display_name())

## ===========================
## VALID TARGET TILES — unified method for arena highlighting
## ===========================

func get_current_valid_target_tiles() -> Array:
	## Returns valid target tiles for the current targeting state.
	if _valid_tile_override.size() > 0:
		return _valid_tile_override
	if _target_use_source:
		return _get_valid_tiles_from_source(_target_range, _target_valid, _target_source_row, _target_source_col)
	elif _target_valid == VT1.UNIT and _target_valid_3 == "cost<SELF":
		return _get_command_target_tiles()
	else:
		return get_valid_spell_tiles(_target_range, _target_valid, _target_valid_2)

func _get_valid_tiles_from_source(range_val: int, valid_target_1: String, src_row: int, src_col: int) -> Array:
	var tiles: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			if range_val > 0:
				var dist := absi(r - src_row) + absi(c - src_col)
				if dist > range_val:
					continue
			var u = grid[r][c]
			match valid_target_1:
				VT1.UNIT:
					if u and _check_alignment_for(u, _target_valid_2):
						tiles.append(Vector2i(r, c))
				VT1.TILE:
					if not u:
						tiles.append(Vector2i(r, c))
				VT1.ENTITY:
					if u and _check_alignment_for(u, _target_valid_2):
						tiles.append(Vector2i(r, c))
				_:
					tiles.append(Vector2i(r, c))
	return tiles

## ===========================
## STEP-BASED ABILITY HANDLERS
## ===========================

## --- ON_ATTACK conditional buff (Bárkakedvenc) ---
## Now handled by ability_queue.dispatch_event("ON_ATTACK") in attack_unit().

## --- AURA (Pirato Sanchez) ---
func get_aura_attack_bonus(unit, row: int, col: int) -> int:
	## Check adjacent tiles for Pirato Sanchez-style aura buffs (CONTINUOUS BUFF_STAT steps).
	var bonus := 0
	for dir in [
		Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1),
		Vector2i(-1, -1), Vector2i(-1, 1), Vector2i(1, -1), Vector2i(1, 1)
	]:
		var nr: int = row + dir.x
		var nc: int = col + dir.y
		if nr >= 0 and nr < GRID_ROWS and nc >= 0 and nc < GRID_COLS:
			var adj = grid[nr][nc]
			if adj and adj.owner_id == unit.owner_id and adj != unit:
				for ab in adj.card.abilities:
					if ab.trigger != null and ab.trigger.event == "CONTINUOUS":
						# Check valid_target_3 for tag filter
						var passes_filter := true
						if ab.valid_target_3 != "":
							passes_filter = _check_target_filter(unit, ab.valid_target_3, null)
						if passes_filter:
							# Look for BUFF_STAT steps with ATK in the step chain
							for step in ab.steps:
								if step and step.step == "ModifyStat" and step.parameters.get("ModifiedStat") == "ATK":
									bonus += int(step.parameters.get("ModifyAmount", 0))
	return bonus

## --- WEAPON return on death ---
func _check_weapon_return(row: int, col: int) -> void:
	var pos_key := "%d,%d" % [row, col]
	if _weapons_on_units.has(pos_key):
		var weapons: Array = _weapons_on_units[pos_key]
		for wpn in weapons:
			var card_id: int = wpn.get("card_id", 0)
			var card_name: String = wpn.get("card_name", "Fegyver")
			var weapon_card = CardDatabaseScript.get_card(card_id)
			if weapon_card and player_hand.size() < 10:
				player_hand.append(weapon_card)
				game_log.emit("🗡 %s visszakerült a kezedbe!" % card_name)
				hand_updated.emit()
			elif player_hand.size() >= 10:
				game_log.emit("🗡 %s nem fér a kezedbe! (10 lap)" % card_name)
		_weapons_on_units.erase(pos_key)

## --- Update weapon positions when unit moves ---
func _update_weapon_position(old_row: int, old_col: int, new_row: int, new_col: int) -> void:
	var old_key := "%d,%d" % [old_row, old_col]
	if _weapons_on_units.has(old_key):
		var new_key := "%d,%d" % [new_row, new_col]
		_weapons_on_units[new_key] = _weapons_on_units[old_key]
		_weapons_on_units.erase(old_key)

## --- Serialize new state for MP ---
func _get_new_ability_state() -> Dictionary:
	## Returns the new ability modifier state for server sync.
	return {
		"opponent_unit_cost_increase": _opponent_unit_cost_increase,
		"next_card_cost_modifier": _next_card_cost_modifier,
		"mana_penalty_next_turn": _mana_penalty_next_turn,
		"my_unit_cost_increase": _my_unit_cost_increase,
		"weapons": _weapons_on_units.duplicate(),
		"named_cards": _named_cards.duplicate(),
	}

## ===========================
## RING SYSTEM (Gyűrű)
## ===========================

func use_ring() -> bool:
	## Initiate ring usage: player clicks a ring on the bench.
	if player_rings <= 0:
		game_log.emit("Nincs gyűrűd!")
		return false
	if _awaiting_ring_target or _awaiting_target or _awaiting_choice:
		return false
	if turn_owner_id != 0:
		return false

	# Check if there's any allied unit on the board to target
	var has_ally := false
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var u = grid[r][c]
			if u and u.owner_id == 0:
				has_ally = true
				break
		if has_ally:
			break
	if not has_ally:
		game_log.emit("Nincs szövetséges egység a pályán!")
		return false

	_awaiting_ring_target = true
	_ring_target_callback = func(row: int, col: int) -> void:
		_awaiting_ring_target = false
		var unit = grid[row][col]
		if not unit or unit.owner_id != 0:
			game_log.emit("Érvénytelen célpont!")
			return
		player_rings -= 1
		unit.add_ring(1)
		game_log.emit("💍 Gyűrű felrakva: %s kap +1/+1! (Gyűrűk: %d → %d, Maradék: %d)" % [
			unit.get_display_name(), unit.rings - 1, unit.rings, player_rings])
		hand_updated.emit()
		_emit_state_changed()

	ring_target_requested.emit(_ring_target_callback)
	game_log.emit("💍 Válassz egy szövetséges egységet a gyűrűhöz!")
	return true

func submit_ring_target(row: int, col: int) -> bool:
	if not _awaiting_ring_target:
		return false
	if row < 0 or row >= GRID_ROWS or col < 0 or col >= GRID_COLS:
		return false
	var unit = grid[row][col]
	if not unit or unit.owner_id != 0:
		return false
	_ring_target_callback.call(row, col)
	return true

func cancel_ring_target() -> void:
	_awaiting_ring_target = false
	game_log.emit("Gyűrű visszavonva.")

func is_awaiting_ring_target() -> bool:
	return _awaiting_ring_target

func get_ring_valid_tiles() -> Array:
	## Returns tiles with allied units that can receive a ring.
	var tiles: Array = []
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var u = grid[r][c]
			if u and u.owner_id == 0:
				tiles.append(Vector2i(r, c))
	return tiles

## ===========================
## WAVE 2 — New card ability handlers
## ===========================

# ─── DISCARD HELPER ───

## Discard a card from hand. Optionally to exile. Triggers ON_DISCARD character abilities.
func _discard_card_from_hand(hand_index: int, to_exile: bool = false) -> void:
	if hand_index < 0 or hand_index >= player_hand.size():
		return
	var card = player_hand[hand_index]
	player_hand.remove_at(hand_index)
	if to_exile:
		player_exile.append(card)
		game_log.emit("⚫ %s száműzve!" % card.card_name)
	else:
		if card.card_type != CardScript.CardType.UNIT and card.card_type != CardScript.CardType.BUILDING and card.card_type != CardScript.CardType.CHARACTER:
			player_pile.append(card)
		else:
			player_discard.append(card)
		game_log.emit("🗑 %s eldobva!" % card.card_name)
	hand_updated.emit()
	_check_on_discard(card)

## Check character ON_DISCARDED abilities (Griff)
func _check_on_discard(_discarded_card) -> void:
	_discards_this_turn += 1
	var ctx := {"discarded_card": _discarded_card, "discards_this_turn": _discards_this_turn, "played_card": _discarded_card, "event_source_owner": 0}
	ability_queue.dispatch_event("ON_DISCARDED", ctx)
