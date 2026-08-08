## AbilityQueue — central sequencer for ALL triggered abilities.
## Collects matching abilities from the board/characters/hand when an event fires,
## orders them by board position, and executes them one at a time via StepExecutor.
##
## Two-tier design:
##   BIG queue (this class) — sequences multiple abilities across the game
##   SMALL executor (StepExecutor) — processes the step chain within a single ability
class_name AbilityQueue
extends RefCounted

const EffectPipelineScript = preload("res://scripts/abilities/effect_pipeline.gd")
const ModifierScript = preload("res://scripts/abilities/modifier.gd")

## Reference to GameManager (for board state, zone access, signals)
var gm: Node = null  ## GameManager

## Reference to StepExecutor (the small executor for step chains)
var executor = null  ## StepExecutor

## The queue of abilities waiting to fire
var _queue: Array = []  ## Array of Dictionaries: {ability, card, unit, context}

## Whether we are currently processing the queue
var _is_processing: bool = false

## Callback to invoke when the entire queue is drained
var _completion_callback: Callable

## PER_TURN / PER_GAME trigger limit counters — cleared on turn start
var limit_counts: Dictionary = {}

func _init(game_manager, step_executor) -> void:
	gm = game_manager
	executor = step_executor

## ===========================
## PUBLIC API
## ===========================

## Dispatch an event: scan all sources for matching abilities, enqueue them,
## then process the queue. Calls `callback` when all abilities have resolved.
func dispatch_event(event_name: String, context: Dictionary, callback: Callable = Callable()) -> void:
	var entries := _collect_matching(event_name, context)
	gm.game_log.emit("DISPATCH: %s → %d abilities" % [event_name, entries.size()])
	if entries.is_empty():
		if callback.is_valid():
			callback.call()
		return

	# Consume trigger limits for all matched abilities
	for entry in entries:
		var trigger = entry.ability.trigger
		if trigger != null:
			trigger.consume_limit(entry.card, limit_counts)

	# Append to queue (supports nested dispatch — new entries go to the end)
	_queue.append_array(entries)

	if _is_processing:
		# Already processing — the new entries will be picked up when the current
		# ability finishes and _process_next is called. Store callback to chain.
		# We need to wrap the existing callback so both fire.
		var old_cb := _completion_callback
		_completion_callback = func() -> void:
			if old_cb.is_valid():
				old_cb.call()
			if callback.is_valid():
				callback.call()
		return

	# Start processing
	_is_processing = true
	_completion_callback = callback
	_process_next()

## Reset PER_TURN trigger limit counters (called from GameManager.start_turn)
func clear_turn_limits() -> void:
	limit_counts.clear()

## Whether the queue is currently processing abilities
func is_processing() -> bool:
	return _is_processing

## ===========================
## COLLECTION — find matching abilities across all sources
## ===========================

func _collect_matching(event_name: String, context: Dictionary) -> Array:
	var result: Array = []
	var _ctx_units_checked: Array = []
	var _ctx_cards_checked: Array = []

	# 0) Pre-scan event-source entities from context.
	#    Cards/units here may not be in any scannable zone (e.g. spells removed
	#    from hand before ON_PLAY, killed units removed from grid before ON_DEATH,
	#    killer units that died in mutual combat before ON_KILL).
	#    Steps 1-3 skip anything already checked here to avoid duplicates.

	# 0a) killed_unit — removed from grid before ON_DEATH dispatch
	var ctx_killed = context.get("killed_unit")
	if ctx_killed != null and ctx_killed is Object and ctx_killed.get("card") != null and ctx_killed.get("owner_id") == 0:
		_ctx_units_checked.append(ctx_killed)
		_ctx_cards_checked.append(ctx_killed.card)
		for ab in ctx_killed.card.abilities:
			if ab.trigger == null:
				continue
			if ab.trigger.matches(event_name, context, ctx_killed.card, ctx_killed, gm, limit_counts):
				result.append({"ability": ab, "card": ctx_killed.card, "unit": ctx_killed, "context": context})

	# 0b) played_card — spells (and discarded cards) removed from hand before dispatch.
	#     Also registers played_unit for dedup so board scan doesn't double-count units.
	var ctx_card = context.get("played_card")
	var ctx_unit = context.get("played_unit")
	if ctx_unit != null and ctx_unit not in _ctx_units_checked:
		_ctx_units_checked.append(ctx_unit)
	if ctx_card != null and ctx_card not in _ctx_cards_checked:
		var card_abilities = ctx_card.get("abilities")
		if card_abilities != null:
			_ctx_cards_checked.append(ctx_card)
			for ab in card_abilities:
				if ab.trigger == null:
					continue
				if ab.trigger.matches(event_name, context, ctx_card, ctx_unit, gm, limit_counts):
					result.append({"ability": ab, "card": ctx_card, "unit": ctx_unit, "context": context})

	# 0c) killer — may have died in mutual combat before ON_KILL dispatch
	var ctx_killer = context.get("killer")
	if ctx_killer != null and ctx_killer is Object and ctx_killer.get("card") != null and ctx_killer.get("owner_id") == 0:
		if ctx_killer not in _ctx_units_checked:
			_ctx_units_checked.append(ctx_killer)
		if ctx_killer.card not in _ctx_cards_checked:
			_ctx_cards_checked.append(ctx_killer.card)
			for ab in ctx_killer.card.abilities:
				if ab.trigger == null:
					continue
				if ab.trigger.matches(event_name, context, ctx_killer.card, ctx_killer, gm, limit_counts):
					result.append({"ability": ab, "card": ctx_killer.card, "unit": ctx_killer, "context": context})

	# 1) Board units — bottom→top (row 4→0), left→right (col 0→4)
	for row in range(gm.GRID_ROWS - 1, -1, -1):
		for col in range(gm.GRID_COLS):
			var unit = gm.grid[row][col]
			if unit == null or unit.card == null:
				continue
			if unit.owner_id != 0:
				continue
			if unit in _ctx_units_checked:
				continue
			for ab in unit.card.abilities:
				if ab.trigger == null:
					continue
				if ab.trigger.matches(event_name, context, unit.card, unit, gm, limit_counts):
					result.append({"ability": ab, "card": unit.card, "unit": unit, "context": context})

	# 2) Characters — left to right
	for character in gm.player_characters:
		if character == null:
			continue
		if character in _ctx_cards_checked:
			continue
		for ab in character.abilities:
			if ab.trigger == null:
				continue
			if ab.trigger.matches(event_name, context, character, null, gm, limit_counts):
				result.append({"ability": ab, "card": character, "unit": null, "context": context})

	# 3) Hand cards — left to right
	for hand_card in gm.player_hand:
		if hand_card == null:
			continue
		if hand_card in _ctx_cards_checked:
			continue
		for ab in hand_card.abilities:
			if ab.trigger == null:
				continue
			if ab.trigger.matches(event_name, context, hand_card, null, gm, limit_counts):
				result.append({"ability": ab, "card": hand_card, "unit": null, "context": context})

	return result

## ===========================
## PROCESSING — execute queued abilities one at a time
## ===========================

func _process_next() -> void:
	if _queue.is_empty():
		_is_processing = false
		if _completion_callback.is_valid():
			var cb := _completion_callback
			_completion_callback = Callable()
			cb.call()
		return

	var entry: Dictionary = _queue.pop_front()
	var ab = entry.ability
	var card = entry.card
	var unit = entry.unit
	var context: Dictionary = entry.context

	if ab.steps.is_empty():
		# No steps — skip
		_process_next()
		return

	gm.game_log.emit("RUN: %s (%d lépés)" % [ab.ability_name, ab.steps.size()])

	# Build EffectPipeline (v2 context)
	var pipe := EffectPipelineScript.new()
	pipe.source_unit = unit
	pipe.source_card = card
	pipe.owner_id = 0
	pipe.trigger_context = context.duplicate()

	# Pre-populate from unit's persistent stored_data (cross-ability state)
	if unit != null and unit.get("stored_data") and unit.stored_data is Dictionary:
		for key in unit.stored_data:
			pipe.store_value(key, unit.stored_data[key])

	# Resolve ability targets into pipe.resolved_targets
	if ab.get("targets") and ab.targets is Array:
		for tgt in ab.targets:
			pipe.resolved_targets.append(gm._resolve_ability_target(tgt, context))

	# Populate trigger interactors
	_populate_trigger_interactors_v2(pipe, context)

	gm.ability_triggered.emit(ab, card)
	gm.game_log.emit("⚡ %s: %s" % [card.card_name, ab.get_effect_text()])

	executor.execute_chain(ab.steps.duplicate(), pipe, func() -> void:
		_process_next()
	)

## ===========================
## HELPERS
## ===========================

func _populate_trigger_interactors_v2(pipe, context: Dictionary) -> void:
	if context.has("played_card"):
		pipe.set_trigger_interactor("PlayedCard", context.played_card)
		pipe.store_value("played_card", context.played_card)
	if context.has("played_unit"):
		pipe.set_trigger_interactor("PlayedUnit", context.played_unit)
		pipe.store_value("played_unit", context.played_unit)
	if context.has("killed_unit"):
		pipe.set_trigger_interactor("KilledUnit", context.killed_unit)
		pipe.store_value("killed_unit", context.killed_unit)
	if context.has("killer"):
		pipe.set_trigger_interactor("KillingUnit", context.killer)
		pipe.store_value("killer", context.killer)
	if context.has("discarded_card"):
		pipe.set_trigger_interactor("DiscardedCard", context.discarded_card)
		pipe.store_value("discarded_card", context.discarded_card)
	if context.has("target"):
		pipe.store_value("target", context.target)
	if context.has("defender"):
		pipe.set_trigger_interactor("AttackedUnit", context.defender)
		pipe.store_value("defender", context.defender)
	if context.has("attacker"):
		pipe.set_trigger_interactor("AttackingUnit", context.attacker)
		pipe.store_value("attacker", context.attacker)
	if context.has("initial_target"):
		pipe.store_value("initial_target", context.initial_target)
		pipe.store_value("INITIAL_TARGET", context.initial_target)
	if context.has("damage_bonus"):
		pipe.set_trigger_interactor("damage_bonus", context.damage_bonus)
	if context.has("cost_modifier"):
		pipe.set_trigger_interactor("cost_modifier", context.cost_modifier)
