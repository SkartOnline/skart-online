## StepExecutor v2 — clean effect engine for the 20 canonical effect step types.
## Uses GameState for all state reads/writes and EffectPipeline for interactor flow.
## References GameManager (gm) only for UI signals and legacy operations
## that will move to GameState incrementally.
class_name StepExecutor
extends RefCounted

const EffectStepScript = preload("res://scripts/abilities/effect_step.gd")
const ModifierScript = preload("res://scripts/abilities/modifier.gd")
const EffectPipelineScript = preload("res://scripts/abilities/effect_pipeline.gd")
const ConditionEvaluatorScript = preload("res://scripts/abilities/condition_evaluator.gd")
const CardDatabaseScript = preload("res://scripts/cards/card_database.gd")

## GameManager reference — used for UI signals, legacy state, and operations
## not yet migrated to GameState.
var gm: Node = null

## Async chain state
var _pending_steps: Array = []
var _pending_pipe = null
var _pending_callback: Callable
var _is_executing: bool = false

func _init(game_manager: Node = null) -> void:
	gm = game_manager

# ══════════════════════════════
#  PUBLIC API
# ══════════════════════════════

func execute_chain(steps: Array, pipe, callback: Callable = Callable()) -> void:
	_log("CHAIN: %d steps" % steps.size())
	if steps.is_empty():
		if callback.is_valid():
			callback.call()
		return
	_is_executing = true
	_pending_callback = callback
	_pending_pipe = pipe
	_run_steps(steps.duplicate(), pipe)

func is_executing() -> bool:
	return _is_executing

# ══════════════════════════════
#  STEP RUNNER
# ══════════════════════════════

func _run_steps(steps: Array, pipe) -> void:
	_pending_steps = steps
	while _pending_steps.size() > 0:
		var step = _pending_steps.pop_front()
		var result := _execute_step(step, pipe)
		if result == "ASYNC":
			_pending_pipe = pipe
			return
	_is_executing = false
	if _pending_callback.is_valid():
		_pending_callback.call()

func _resume_chain() -> void:
	if _pending_steps.size() > 0 and _pending_pipe != null:
		_run_steps(_pending_steps, _pending_pipe)
	else:
		_is_executing = false
		if _pending_callback.is_valid():
			_pending_callback.call()

# ══════════════════════════════
#  STEP DISPATCH
# ══════════════════════════════

func _execute_step(step, pipe) -> String:
	_log("STEP: %s ref=%s tag=%s" % [step.step, step.target_ref, step.tag])

	# ── Flow control ──
	if step.has_flow():
		var flow_type: String = step.get_flow_type()
		match flow_type:
			"conditional":
				return _flow_conditional(step, pipe)
			"repeat":
				return _flow_repeat(step, pipe)
			"repeat_while":
				return _flow_repeat_while(step, pipe)
			"for_each":
				return _flow_for_each(step, pipe)
			"choose_one":
				return _flow_choose_one(step, pipe)

	# ── Inline target resolution ──
	if step.inline_target != null and step.target_ref == "":
		return _resolve_inline_target(step, pipe)

	# ── Dispatch to canonical step handler ──
	match step.step:
		"Draw":           return _step_draw(step, pipe)
		"Search":         return _step_search(step, pipe)
		"Reveal":         return _step_reveal(step, pipe)
		"Discard":        return _step_discard(step, pipe)
		"MoveToZone":     return _step_move_to_zone(step, pipe)
		"Kill":           return _step_kill(step, pipe)
		"Exile":          return _step_exile(step, pipe)
		"DealDamage":     return _step_deal_damage(step, pipe)
		"Heal":           return _step_heal(step, pipe)
		"ModifyStat":     return _step_modify_stat(step, pipe)
		"ModifyKeyword":  return _step_modify_keyword(step, pipe)
		"ModifyCounter":  return _step_modify_counter(step, pipe)
		"Summon":         return _step_summon(step, pipe)
		"Move":           return _step_move(step, pipe)
		"Swap":           return _step_swap(step, pipe)
		"MakeAttack":     return _step_make_attack(step, pipe)
		"Attach":         return _step_attach(step, pipe)
		"ExecuteAbility": return _step_execute_ability(step, pipe)
		"AutoPlay":       return _step_auto_play(step, pipe)
		"PlayCard":       return _step_play_card(step, pipe)
		_:
			_log("⚠ Unknown step type: %s" % step.step)
			return "OK"

# ══════════════════════════════
#  STEP IMPLEMENTATIONS
# ══════════════════════════════

# ──── DRAW ────
func _step_draw(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var amount: int = pipe.resolve_param(params.get("DrawAmount", 1))
	if amount <= 0:
		return "OK"

	# Resolve source zone from target_ref
	var source_cards: Array = _resolve_zone_cards(step, pipe)
	if source_cards.is_empty():
		source_cards = gm.player_deck  # Default: ally deck

	var filter_str: String = String(params.get("DrawFilters", ""))
	var drawn: Array = []
	for _i in range(amount):
		if gm.player_hand.size() >= 10:
			_log("A kezed tele van! (10 lap)")
			break
		var picked = _pick_from_array(source_cards, filter_str, pipe, true)
		if picked == null:
			break
		gm.player_hand.append(picked)
		drawn.append(picked)
		gm.card_drawn.emit(picked)
		_log("Húztál: %s" % picked.card_name)

	if drawn.size() > 0:
		gm.hand_updated.emit()
	_store_output(step, pipe, {"DrawnCard": drawn if drawn.size() > 1 else (drawn[0] if drawn.size() == 1 else null)})
	return "OK"

# ──── SEARCH ────
func _step_search(step, pipe) -> String:
	var params: Dictionary = step.parameters

	# Phase 1: Gather pool
	var pool: Array = _resolve_zone_cards(step, pipe)

	# Phase 2: Apply SearchFilters
	var filter_str: String = String(params.get("SearchFilters", ""))
	var filtered: Array = _filter_cards(pool, filter_str, pipe)
	if filtered.is_empty():
		_store_output(step, pipe, {"SearchedZone": pool, "SearchResults": [], "SelectedCards": []})
		return "OK"

	# Phase 3: ShownAmount (random subset)
	var shown_amount: int = pipe.resolve_param(params.get("ShownAmount", 0))
	var shown: Array = filtered.duplicate()
	if shown_amount > 0 and shown_amount < shown.size():
		shown.shuffle()
		shown = shown.slice(0, shown_amount)

	# Phase 4: SelectAmount
	var select_raw = params.get("SelectAmount", 0)
	var select_amount: int = 0
	if select_raw is String and String(select_raw) == "== ShownAmount":
		select_amount = -1  # Sentinel: select all shown
	elif select_raw is String and String(select_raw) == "any":
		select_amount = -2  # Sentinel: player picks any number
	else:
		select_amount = pipe.resolve_param(select_raw)

	# -1 or 0 = auto-select all shown, no interaction
	if select_amount == -1 or select_amount == 0:
		_store_output(step, pipe, {"SearchedZone": pool, "SearchResults": shown, "SelectedCards": shown})
		return "OK"

	# "any" mode: always interactive (skip auto-select)
	if select_amount == -2:
		var any_prompt: String = String(params.get("Prompt", "Válassz lapokat!"))
		var any_step = step
		var any_pipe = pipe
		gm.search_pick_requested.emit(shown, -1, any_prompt, func(selected: Array) -> void:
			_store_output(any_step, any_pipe, {"SearchedZone": pool, "SearchResults": shown, "SelectedCards": selected})
			_resume_chain()
		)
		_log("🔍 %s" % any_prompt)
		return "ASYNC"

	# Auto-select if not enough to choose from
	if shown.size() <= select_amount:
		_store_output(step, pipe, {"SearchedZone": pool, "SearchResults": shown, "SelectedCards": shown})
		return "OK"

	# Phase 5: Interactive — player picks
	var prompt_text: String = String(params.get("Prompt", "Válassz %d lapot!" % select_amount))
	var step_ref = step
	var pipe_ref = pipe
	gm.search_pick_requested.emit(shown, select_amount, prompt_text, func(selected: Array) -> void:
		_store_output(step_ref, pipe_ref, {"SearchedZone": pool, "SearchResults": shown, "SelectedCards": selected})
		_resume_chain()
	)
	_log("🔍 %s" % prompt_text)
	return "ASYNC"

# ──── REVEAL ────
func _step_reveal(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var amount: int = pipe.resolve_param(params.get("RevealAmount", 1))
	var source_cards: Array = _resolve_zone_cards(step, pipe)

	var revealed: Array = []
	for _i in range(amount):
		var idx: int = source_cards.size() - 1 - revealed.size()
		if idx >= 0:
			revealed.append(source_cards[idx])

	for card in revealed:
		_log("⚡ Felső lap: %s" % card.card_name)

	_store_output(step, pipe, {"RevealedCards": revealed})
	return "OK"

# ──── DISCARD ────
func _step_discard(step, pipe) -> String:
	var target = pipe.resolve_ref(step.target_ref)
	var discarded: Array = []
	var cards: Array = target if target is Array else ([target] if target != null else [])
	for card in cards:
		var idx: int = gm.player_hand.find(card)
		if idx >= 0:
			gm._discard_card_from_hand(idx, true)
			discarded.append(card)
	_store_output(step, pipe, {"DiscardedCards": discarded})
	return "OK"

# ──── MOVE TO ZONE ────
func _step_move_to_zone(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var target = pipe.resolve_ref(step.target_ref)
	var goal_zone_name: String = String(params.get("GoalZone", ""))

	if target == null:
		_log("⚠ MoveToZone: no target")
		return "OK"

	# Find and remove from current zone
	var origin_zone_name: String = _find_and_remove_from_zones(target)

	# Add to goal zone
	var is_robbery: bool = _begins_with_enemy(origin_zone_name) and _begins_with_ally(goal_zone_name)
	_add_to_zone_by_name(target, goal_zone_name, is_robbery)

	_store_output(step, pipe, {"MovedCard": target, "OriginZone": origin_zone_name, "GoalZone": goal_zone_name})
	return "OK"

# ──── KILL ────
func _step_kill(step, pipe) -> String:
	var targets := _resolve_targets(step, pipe)
	var killed: Array = []
	for target in targets:
		if target != null and target.has_method("is_alive"):
			_log("💀 %s megsemmisítve!" % target.get_display_name())
			gm._kill_unit(target.grid_row, target.grid_col, pipe.source_unit)
			killed.append(target)
	_store_output(step, pipe, {"KilledUnit": killed[0] if killed.size() == 1 else killed})
	return "OK"

# ──── EXILE ────
func _step_exile(step, pipe) -> String:
	var target = pipe.resolve_ref(step.target_ref)
	var exiled: Array = []
	var cards: Array = target if target is Array else ([target] if target != null else [])
	for card in cards:
		_remove_card_from_any_zone(card)
		gm.player_exile.append(card)
		exiled.append(card)
		_log("⚫ %s száműzve!" % card.card_name)
	gm.hand_updated.emit()
	_store_output(step, pipe, {"ExiledUnit": exiled[0] if exiled.size() == 1 else exiled})
	return "OK"

# ──── DEAL DAMAGE ────
func _step_deal_damage(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var amount: int = pipe.resolve_param(params.get("DamageAmount", 0))

	# Apply damage bonus from trigger context
	var bonus = pipe.get_trigger_interactor("damage_bonus")
	if bonus is int:
		amount += bonus

	var targets := _resolve_targets(step, pipe)
	var damaged: Array = []
	for target in targets:
		if target == null:
			continue
		if target is int:
			# Player target
			if target == 1:
				gm._damage_enemy_player(amount)
			else:
				gm._damage_player(amount)
			damaged.append(target)
		elif target.has_method("take_damage"):
			target.take_damage(amount)
			gm.unit_damaged.emit(target, amount)
			_log("💥 %s kap %d sebzést! (%s)" % [target.get_display_name(), amount, target.get_stats_text()])
			if not target.is_alive():
				gm._kill_unit(target.grid_row, target.grid_col, pipe.source_unit)
			damaged.append(target)

	_store_output(step, pipe, {"DamagedEntity": damaged[0] if damaged.size() == 1 else damaged})
	return "OK"

# ──── HEAL ────
func _step_heal(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var amount: int = pipe.resolve_param(params.get("HealAmount", 0))
	var targets := _resolve_targets(step, pipe)
	var healed: Array = []
	for target in targets:
		if target != null and target.has_method("heal"):
			target.heal(amount)
			_log("💚 %s gyógyul %d-t! (%s)" % [target.get_display_name(), amount, target.get_stats_text()])
			healed.append(target)
	_store_output(step, pipe, {"HealedEntity": healed[0] if healed.size() == 1 else healed})
	return "OK"

# ──── MODIFY STAT ────
func _step_modify_stat(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var stat_name: String = String(params.get("ModifiedStat", "ATK"))
	var amount: int = pipe.resolve_param(params.get("ModifyAmount", 0))
	var set_amount = params.get("SetAmount", null)
	var duration: int = pipe.resolve_param(params.get("ModifyDuration", 0))  # 0 = permanent

	match stat_name:
		"COST":
			return _apply_cost_modifier(step, pipe, amount, duration)
		"DAMAGE_BONUS":
			return _apply_damage_modifier(step, pipe, amount, duration)
		"MOVE_SPEED":
			return _apply_move_speed(step, pipe, amount)

	# ATK / HP / ATK_HP stat modification on units
	var targets := _resolve_targets(step, pipe)
	var modified: Array = []
	for target in targets:
		if target == null or not target.has_method("is_alive"):
			continue
		if set_amount != null:
			# SetAmount: absolute override
			var set_val: int = pipe.resolve_param(set_amount)
			match stat_name:
				"ATK":
					target.current_attack = set_val
				"HP":
					target.current_hp = set_val
		else:
			var mod := ModifierScript.create_stat(stat_name, amount, duration, 0, gm.turn_number)
			target.add_modifier(mod)
		modified.append(target)
		_log_stat_change(target, stat_name, amount)

	_store_output(step, pipe, {"ModifiedEntity": modified[0] if modified.size() == 1 else modified})
	return "OK"

func _apply_cost_modifier(step, pipe, amount: int, duration: int) -> String:
	var params: Dictionary = step.parameters
	var filter_str: String = String(params.get("ApplyFilter", ""))
	var target_player: int = 0
	if step.target_ref == "OPPONENT":
		target_player = 1
	elif step.target_ref != "":
		var resolved = pipe.resolve_ref(step.target_ref)
		if resolved is int:
			target_player = resolved
	var mod := ModifierScript.create_cost(amount, filter_str, duration, target_player, 0, gm.turn_number)
	gm.global_modifiers.append(mod)
	# Bridge cross-player cost modifier for server serialization (Határzár)
	if target_player == 1 and filter_str.contains("type:UNIT"):
		gm._opponent_unit_cost_increase = amount
	_log("⚡ Költségmódosítás: %+d (%s)" % [amount, filter_str])
	gm.hand_updated.emit()
	_store_output(step, pipe, {"ModifiedEntity": target_player})
	return "OK"

func _apply_damage_modifier(step, pipe, amount: int, duration: int) -> String:
	var params: Dictionary = step.parameters
	var filter_str: String = String(params.get("ApplyFilter", ""))
	var mod := ModifierScript.create_damage(amount, filter_str, duration, 0, gm.turn_number)
	gm.global_modifiers.append(mod)
	_log("⚡ +%d sebzés módosító!" % amount)
	_store_output(step, pipe, {"ModifiedEntity": null})
	return "OK"

func _apply_move_speed(step, pipe, amount: int) -> String:
	var targets := _resolve_targets(step, pipe)
	for target in targets:
		if target != null and target.has_method("is_alive"):
			target.moves_remaining += amount
			_log("⚡ %s kap +%d mozgási sebességet!" % [target.get_display_name(), amount])
	_store_output(step, pipe, {"ModifiedEntity": targets})
	return "OK"

# ──── MODIFY KEYWORD ────
func _step_modify_keyword(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var added: Array = params.get("AddedKeywords", []) if params.get("AddedKeywords") is Array else []
	var removed: Array = params.get("RemovedKeywords", []) if params.get("RemovedKeywords") is Array else []
	var duration: int = pipe.resolve_param(params.get("NewKeywordDurations", 0))

	var targets := _resolve_targets(step, pipe)
	var modified: Array = []
	for target in targets:
		if target == null or not target.has_method("is_alive"):
			continue
		for kw in added:
			var mod := ModifierScript.create_keyword(String(kw), duration, 0, gm.turn_number)
			target.add_modifier(mod)
			_log("⚡ %s kap kulcsszót: %s" % [target.get_display_name(), kw])
		for kw in removed:
			target.remove_keyword(String(kw))
			_log("⚡ %s elveszíti: %s" % [target.get_display_name(), kw])
		modified.append(target)
	_store_output(step, pipe, {"ModifiedEntity": modified[0] if modified.size() == 1 else modified})
	return "OK"

# ──── MODIFY COUNTER ────
func _step_modify_counter(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var counter_type: String = String(params.get("CounterType", "Ring"))
	var amount: int = pipe.resolve_param(params.get("ModifyAmount", 0))

	match counter_type:
		"Mana":
			return _apply_mana_change(step, pipe, amount)
		_:  # Default: Ring
			return _apply_ring_change(step, pipe, amount)

func _apply_mana_change(step, pipe, amount: int) -> String:
	var target = pipe.resolve_ref(step.target_ref)
	var target_player: int = 0
	if target is int:
		target_player = target
	if target_player == 0:
		if amount < 0:
			gm._mana_penalty_next_turn += absi(amount)
			_log("⚠ A következő körödben -%d elérhető mana!" % absi(amount))
		else:
			gm.player_mana += amount
			_log("⚡ +%d mana! (Mana: %d/%d)" % [amount, gm.player_mana, gm.player_max_mana])
	_store_output(step, pipe, {"ModifiedEntity": target_player})
	return "OK"

func _apply_ring_change(step, pipe, amount: int) -> String:
	var target = pipe.resolve_ref(step.target_ref)
	if target == null:
		target = pipe.source_unit

	if target is int:
		# Player ring change
		if target == 0:
			if amount >= 0:
				gm.player_rings += amount
				_log("💍 +%d gyűrű a padra!" % amount)
			else:
				gm.player_rings = maxi(0, gm.player_rings + amount)
				_log("⚡ %d gyűrű a padról!" % amount)
		else:
			# Enemy rings — track on enemy player state
			_log("💍 Ellenfél %+d gyűrű!" % amount)
	elif target != null and target.has_method("is_alive"):
		if amount >= 0:
			target.add_ring(amount)
			_log("💍 %s kap +%d gyűrűt! (%s)" % [target.get_display_name(), amount, target.get_stats_text()])
		else:
			target.rings = maxi(0, target.rings + amount)
			_log("⚡ Gyűrű elvéve %s-tól/től! (%s)" % [target.get_display_name(), target.get_stats_text()])
			if not target.is_alive():
				gm._kill_unit(target.grid_row, target.grid_col, null)
	elif step.target_ref == "SELF" and pipe.source_unit == null:
		# Character ability — add to player bench
		gm.player_rings += amount
		_log("💍 +%d gyűrű a padra!" % amount)

	_store_output(step, pipe, {"ModifiedEntity": target})
	return "OK"

# ──── SUMMON ────
func _step_summon(step, pipe) -> String:
	var params: Dictionary = step.parameters
	# What to summon
	var card = null
	var entity_ref: String = String(params.get("SummonedEntity", ""))
	if entity_ref != "":
		card = pipe.resolve_ref(entity_ref)
	if card == null and step.target_ref != "":
		var ref_val = pipe.resolve_ref(step.target_ref)
		if ref_val != null and ref_val is not Vector2i:
			card = ref_val
	if card == null:
		return "OK"

	# Where to place
	var tile_ref: String = String(params.get("SummoningTile", ""))
	var tile_pos = null
	if tile_ref != "":
		tile_pos = pipe.resolve_ref(tile_ref)
	if tile_pos == null and step.target_ref != "":
		var pos_val = pipe.resolve_ref(step.target_ref)
		if pos_val is Vector2i:
			tile_pos = pos_val

	if tile_pos is Vector2i:
		_place_unit_from_card(card, tile_pos.x, tile_pos.y, pipe)
		_store_output(step, pipe, {"SummonedEntity": card})
		return "OK"

	# Resolve optional SummonConstraint (e.g. "adjacent_to:PlayedUnit")
	var constraint: String = String(params.get("SummonConstraint", ""))
	var summon_prompt: String = String(params.get("SummonPrompt", ""))

	# Async tile pick
	return _async_pick_tile_for_summon(card, step, pipe, constraint, summon_prompt)

func _async_pick_tile_for_summon(card, step, pipe, constraint: String = "", prompt: String = "") -> String:
	# Pre-compute valid placement tiles (base row OR adjacent to ally, and empty)
	var valid_tiles: Array = []
	# Parse adjacency constraint: "adjacent_to:REF"
	var adj_row: int = -1
	var adj_col: int = -1
	if constraint.begins_with("adjacent_to:"):
		var ref_name := constraint.substr(12)
		var ref_obj = pipe.resolve_ref(ref_name)
		if ref_obj != null and ref_obj.has_method("is_alive"):
			adj_row = ref_obj.grid_row
			adj_col = ref_obj.grid_col
	for r in range(gm.GRID_ROWS):
		for c in range(gm.GRID_COLS):
			if gm.grid[r][c] != null:
				continue
			if not gm._is_valid_unit_placement(r, c):
				continue
			if adj_row >= 0:
				var dist: int = absi(r - adj_row) + absi(c - adj_col)
				if dist != 1:
					continue
			valid_tiles.append(Vector2i(r, c))
	if valid_tiles.is_empty():
		_log("⚠ Nincs érvényes mező az egység lehelyezéséhez!")
		return "OK"
	gm._awaiting_target = true
	gm._target_valid = "TILE"
	gm._target_valid_2 = "ANY"
	gm._target_valid_3 = ""
	gm._target_range = 0
	gm._target_source_row = -1
	gm._target_source_col = -1
	gm._target_use_source = false
	gm._valid_tile_override = valid_tiles
	gm._target_callback = func(row: int, col: int) -> void:
		gm._awaiting_target = false
		gm._valid_tile_override = []
		var pos := Vector2i(row, col)
		if pos not in valid_tiles:
			_log("Érvénytelen lehelyezési mező!")
			_resume_chain()
			return
		_place_unit_from_card(card, row, col, pipe)
		_store_output(step, pipe, {"SummonedEntity": card})
		_resume_chain()
	gm.target_requested.emit(gm._target_valid, gm._target_range, gm._target_source_row, gm._target_source_col, gm._target_callback)
	var prompt_text: String = prompt if not prompt.is_empty() else "Válassz mezőt az egység lehelyezéséhez!"
	_log("⚡ %s" % prompt_text)
	return "ASYNC"

func _place_unit_from_card(card, row: int, col: int, _pipe) -> void:
	# Remove from hand if present
	var idx: int = gm.player_hand.find(card)
	if idx >= 0:
		gm.player_hand.remove_at(idx)
		gm.hand_updated.emit()
	var unit = gm.UnitInstanceScript.new(card, 0)
	unit.grid_row = row
	unit.grid_col = col
	gm.grid[row][col] = unit
	gm.card_played.emit(card, row, col)
	_log("⚡ %s kijátszva a(z) %s mezőre!" % [card.card_name, gm._cell_label(row, col)])
	# Trigger ON_PLAY via ability queue
	var ctx_dict := {
		"played_card": card,
		"played_unit": unit,
		"event_source_owner": 0,
	}
	gm.ability_queue.dispatch_event("ON_PLAY", ctx_dict)

# ──── MOVE ────
func _step_move(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var target = pipe.resolve_ref(step.target_ref)
	if target == null or not target.has_method("is_alive"):
		return "OK"
	var amount: int = pipe.resolve_param(params.get("MoveAmount", 1))
	# Async tile pick
	gm._awaiting_target = true
	gm._target_valid = "TILE"
	gm._target_valid_2 = "ANY"
	gm._target_valid_3 = ""
	gm._target_range = amount
	gm._target_source_row = target.grid_row
	gm._target_source_col = target.grid_col
	gm._target_use_source = true
	var unit_ref = target
	var step_ref = step
	gm._target_callback = func(row: int, col: int) -> void:
		gm._awaiting_target = false
		gm._target_use_source = false
		if gm.grid[row][col] != null:
			_resume_chain()
			return
		gm.grid[unit_ref.grid_row][unit_ref.grid_col] = null
		gm.grid[row][col] = unit_ref
		unit_ref.grid_row = row
		unit_ref.grid_col = col
		_log("🏃 Parancs! %s mozgatva: %s" % [unit_ref.get_display_name(), gm._cell_label(row, col)])
		_store_output(step_ref, pipe, {"MovedUnit": unit_ref})
		_resume_chain()
	gm.target_requested.emit(gm._target_valid, gm._target_range, gm._target_source_row, gm._target_source_col, gm._target_callback)
	_log("⚡ Válassz mezőt az egység mozgatásához!")
	return "ASYNC"

# ──── SWAP ────
func _step_swap(step, pipe) -> String:
	var targets := _resolve_targets(step, pipe)
	if targets.size() < 2:
		return "OK"
	var a = targets[0]
	var b = targets[1]
	if a.has_method("is_alive") and b.has_method("is_alive"):
		# Swap two units
		var ar: int = a.grid_row
		var ac: int = a.grid_col
		gm.grid[a.grid_row][a.grid_col] = b
		gm.grid[b.grid_row][b.grid_col] = a
		a.grid_row = b.grid_row
		a.grid_col = b.grid_col
		b.grid_row = ar
		b.grid_col = ac
		_log("🔄 %s és %s helyet cseréltek!" % [a.get_display_name(), b.get_display_name()])
	_store_output(step, pipe, {"SwappedEntity1": a, "SwappedEntity2": b})
	return "OK"

# ──── MAKE ATTACK ────
func _step_make_attack(step, pipe) -> String:
	var target = pipe.resolve_ref(step.target_ref)
	if target == null or not target.has_method("is_alive"):
		return "OK"
	var atk_targets: Array = gm.get_command_attack_targets(target.grid_row, target.grid_col)
	var can_hit_player: bool = gm.can_command_attack_player(target.grid_row, target.grid_col)

	if atk_targets.is_empty() and not can_hit_player:
		_log("Nincs érvényes támadási célpont!")
		return "OK"
	if atk_targets.size() == 1 and not can_hit_player:
		var pos: Vector2i = atk_targets[0]
		gm._command_attack(target, target.grid_row, target.grid_col, pos.x, pos.y)
		_store_output(step, pipe, {"AttackingUnit": target, "AttackedEntity": gm.grid[pos.x][pos.y]})
		return "OK"
	if atk_targets.is_empty() and can_hit_player:
		gm._command_attack_player(target, target.grid_row, target.grid_col)
		_store_output(step, pipe, {"AttackingUnit": target, "AttackedEntity": 1})
		return "OK"

	# Multiple targets — async pick
	gm._awaiting_target = true
	gm._target_valid = "UNIT"
	gm._target_valid_2 = "ENEMY"
	gm._target_valid_3 = ""
	gm._target_range = target.card.attack_range if target.card.get("attack_range") else 1
	gm._target_source_row = target.grid_row
	gm._target_source_col = target.grid_col
	gm._target_use_source = true
	var unit_ref = target
	var step_ref = step
	gm._target_callback = func(def_row: int, def_col: int) -> void:
		gm._awaiting_target = false
		gm._target_use_source = false
		if def_row == -1 and def_col == -1:
			gm._command_attack_player(unit_ref, unit_ref.grid_row, unit_ref.grid_col)
			_store_output(step_ref, pipe, {"AttackingUnit": unit_ref, "AttackedEntity": 1})
		else:
			gm._command_attack(unit_ref, unit_ref.grid_row, unit_ref.grid_col, def_row, def_col)
			_store_output(step_ref, pipe, {"AttackingUnit": unit_ref, "AttackedEntity": gm.grid[def_row][def_col]})
		_resume_chain()
	gm.target_requested.emit(gm._target_valid, gm._target_range, gm._target_source_row, gm._target_source_col, gm._target_callback)
	_log("⚡ Parancs: Válassz célpontot!")
	return "ASYNC"

# ──── ATTACH ────
func _step_attach(step, pipe) -> String:
	var target = pipe.resolve_ref(step.target_ref)
	if target == null or not target.has_method("is_alive"):
		return "OK"
	var attachment := {
		"card_id": pipe.source_card.card_id if pipe.source_card else 0,
		"card_name": pipe.source_card.card_name if pipe.source_card else "",
		"detach_steps": step.sub_effects,
		"source_card": pipe.source_card,
	}
	target.attached_cards.append(attachment)
	_log("⚔ %s csatolva: %s" % [attachment.card_name, target.get_display_name()])
	_store_output(step, pipe, {"HostUnit": target, "AttachedCard": pipe.source_card})
	return "OK"

# ──── EXECUTE ABILITY ────
func _step_execute_ability(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var target = pipe.resolve_ref(step.target_ref)
	if target == null:
		return "OK"
	var card = null
	if target.has_method("is_alive"):
		card = target.card
	elif target.get("abilities"):
		card = target
	if card == null:
		return "OK"

	var trigger_filter: String = String(params.get("AbilityType", "ON_PLAY"))
	var copied: Array = []
	for ab in card.abilities:
		if ab and _get_ability_trigger_event(ab) == trigger_filter and ab.effects.size() > 0:
			copied.append(ab)
	if copied.is_empty():
		return "OK"

	_execute_copied_seq(copied, 0, card, pipe)
	return "ASYNC"

func _execute_copied_seq(abilities: Array, index: int, card, parent_pipe) -> void:
	if index >= abilities.size():
		_store_output(null, parent_pipe, {"AbilitySource": card})
		_resume_chain()
		return
	var ab = abilities[index]
	_log("⚡ Képesség: %s aktiválódik!" % card.card_name)
	var sub_pipe := EffectPipelineScript.new()
	sub_pipe.source_unit = parent_pipe.source_unit
	sub_pipe.source_card = card
	sub_pipe.counters = parent_pipe.counters
	sub_pipe.owner_id = parent_pipe.owner_id
	sub_pipe.trigger_context = parent_pipe.trigger_context.duplicate()
	if not sub_pipe.trigger_context.has("played_card"):
		sub_pipe.trigger_context["played_card"] = card
	var sub_executor := StepExecutor.new(gm)
	sub_executor.execute_chain(ab.effects.duplicate(), sub_pipe, func() -> void:
		_execute_copied_seq(abilities, index + 1, card, parent_pipe)
	)

# ──── AUTO PLAY ────
func _step_auto_play(_step, _pipe) -> String:
	# TODO: implement auto play logic
	return "OK"

# ──── PLAY CARD ────
func _step_play_card(step, pipe) -> String:
	var params: Dictionary = step.parameters
	var extra_cost: int = pipe.resolve_param(params.get("ExtraCost", 0))

	# Resolve card
	var card = pipe.resolve_ref(step.target_ref)
	if card is Array:
		card = card[0] if (card as Array).size() > 0 else null
	if card == null:
		_log("⚠ PlayCard: nincs céllapja!")
		return "OK"

	# Calculate and deduct cost: card's base cost + extra_cost
	var base_cost: int = int(card.get("cost")) if card.get("cost") != null else 0
	var effective_cost: int = maxi(0, base_cost + extra_cost)
	if gm.player_mana < effective_cost:
		_log("⚠ Nincs elég manád a portálhoz! (%d manára van szükség)" % effective_cost)
		return "OK"
	gm.player_mana -= effective_cost
	gm.hand_updated.emit()

	# Remove from side deck (if present)
	var sd_idx: int = gm.player_side_deck.find(card)
	if sd_idx >= 0:
		gm.player_side_deck.remove_at(sd_idx)

	# Place on board with tile selection, firing ON_PLAY
	return _async_pick_tile_for_summon(card, step, pipe)

# ══════════════════════════════
#  FLOW CONTROL
# ══════════════════════════════

func _flow_conditional(step, pipe) -> String:
	var condition_str: String = String(step.flow.get("condition", ""))
	var passes: bool = ConditionEvaluatorScript.evaluate_flow(condition_str, pipe, _get_game_state())
	if passes:
		if step.sub_effects.size() > 0:
			_pending_steps = step.sub_effects.duplicate() + _pending_steps
		# If the step itself has an action, execute it
		var has_action: bool = step.step != "" and step.step != "Conditional"
		if has_action:
			return _execute_step_inner(step, pipe)
	else:
		if step.else_effects.size() > 0:
			_pending_steps = step.else_effects.duplicate() + _pending_steps
	return "OK"

func _flow_repeat(step, pipe) -> String:
	var count: int = pipe.resolve_param(step.flow.get("count", 0))
	if count <= 0 or step.sub_effects.is_empty():
		return "OK"
	var unrolled: Array = []
	for _i in range(count):
		for s in step.sub_effects:
			unrolled.append(s)
	_pending_steps = unrolled + _pending_steps
	return "OK"

func _flow_repeat_while(step, pipe) -> String:
	var condition_str: String = String(step.flow.get("condition", ""))
	if not ConditionEvaluatorScript.evaluate_flow(condition_str, pipe, _get_game_state()):
		return "OK"
	var chain: Array = step.sub_effects.duplicate()
	chain.append(step)  # Re-evaluate after sub_effects
	_pending_steps = chain + _pending_steps
	return "OK"

func _flow_for_each(step, pipe) -> String:
	var source_ref: String = String(step.flow.get("source", ""))
	var items: Array = []
	if source_ref != "":
		var resolved = pipe.resolve_ref(source_ref)
		if resolved is Array:
			items = resolved.duplicate()

	if items.is_empty() or step.sub_effects.is_empty():
		return "OK"

	_for_each_recursive(items, 0, step.sub_effects, pipe)
	return "ASYNC"

func _for_each_recursive(items: Array, index: int, sub_steps: Array, pipe) -> void:
	if index >= items.size():
		_resume_chain()
		return
	pipe.current_item = items[index]
	var sub_executor := StepExecutor.new(gm)
	sub_executor.execute_chain(sub_steps.duplicate(), pipe, func() -> void:
		_for_each_recursive(items, index + 1, sub_steps, pipe)
	)

func _flow_choose_one(step, _pipe) -> String:
	if step.choices.is_empty():
		return "OK"
	var labels: Array = []
	for choice in step.choices:
		labels.append(choice.get("label", "?"))
	gm._awaiting_choice = true
	gm._choice_callback = func(chosen_index) -> void:
		gm._awaiting_choice = false
		var idx: int = chosen_index if chosen_index is int else 0
		if idx >= 0 and idx < step.choices.size():
			var chosen_steps: Array = step.choices[idx].get("effects", step.choices[idx].get("steps", []))
			if chosen_steps.size() > 0:
				_pending_steps = chosen_steps.duplicate() + _pending_steps
		_resume_chain()
	gm.choose_one_requested.emit(labels, gm._choice_callback)
	_log("⚡ Válassz egyet!")
	return "ASYNC"

# ══════════════════════════════
#  INLINE TARGET RESOLUTION
# ══════════════════════════════

func _resolve_inline_target(step, pipe) -> String:
	var itgt = step.inline_target
	var tt: String = String(itgt.target_type) if itgt.get("target_type") else "Unit"
	var own: String = String(itgt.owner) if itgt.get("owner") else "Any"
	var cond: String = String(itgt.condition) if itgt.get("condition") else ""
	var targeting: String = String(itgt.targeting) if itgt.get("targeting") else "Automatic"
	var prompt_text: String = String(itgt.prompt) if itgt.get("prompt") else ""
	var tgt_count: int = int(itgt.count) if itgt.get("count") else 1
	var tgt_range: int = int(itgt.target_range) if itgt.get("target_range") else -1

	var candidates: Array = []
	var is_zone_target: bool = false

	match tt:
		"Card", "Hand":
			is_zone_target = true
			candidates = _gather_zone_candidates(own, "hand", cond, pipe)
		"Deck":
			is_zone_target = true
			candidates = _gather_zone_candidates(own, "deck", cond, pipe)
		"Graveyard":
			is_zone_target = true
			candidates = _gather_zone_candidates(own, "graveyard", cond, pipe)
		"Pile":
			is_zone_target = true
			candidates = _gather_zone_candidates(own, "pile", cond, pipe)
		_:
			candidates = _gather_board_candidates(tt, own, cond, tgt_range, pipe)

	if candidates.is_empty():
		return "OK"

	match targeting:
		"Automatic", "AllValid":
			pipe.store_value("__inline_target__", candidates[0] if candidates.size() == 1 else candidates)
			return _dispatch_with_inline(step, pipe)
		"Random":
			candidates.shuffle()
			var picked = candidates[0] if tgt_count == 1 else candidates.slice(0, mini(tgt_count, candidates.size()))
			pipe.store_value("__inline_target__", picked)
			return _dispatch_with_inline(step, pipe)
		"PlayerChoice":
			if candidates.size() <= tgt_count:
				pipe.store_value("__inline_target__", candidates[0] if candidates.size() == 1 else candidates)
				return _dispatch_with_inline(step, pipe)
			if is_zone_target:
				return _async_pick_from_cards(step, pipe, candidates, prompt_text, tgt_count)
			return _async_pick_from_board(step, pipe, candidates, prompt_text)
		"Self":
			if pipe.source_unit != null:
				pipe.store_value("__inline_target__", pipe.source_unit)
				return _dispatch_with_inline(step, pipe)
			return "OK"
		_:
			return "OK"

func _dispatch_with_inline(step, pipe) -> String:
	var original_ref: String = step.target_ref
	step.target_ref = "__inline_target__"
	var result: String = _execute_step_inner(step, pipe)
	step.target_ref = original_ref
	return result

func _execute_step_inner(step, pipe) -> String:
	match step.step:
		"Draw":           return _step_draw(step, pipe)
		"Search":         return _step_search(step, pipe)
		"Reveal":         return _step_reveal(step, pipe)
		"Discard":        return _step_discard(step, pipe)
		"MoveToZone":     return _step_move_to_zone(step, pipe)
		"Kill":           return _step_kill(step, pipe)
		"Exile":          return _step_exile(step, pipe)
		"DealDamage":     return _step_deal_damage(step, pipe)
		"Heal":           return _step_heal(step, pipe)
		"ModifyStat":     return _step_modify_stat(step, pipe)
		"ModifyKeyword":  return _step_modify_keyword(step, pipe)
		"ModifyCounter":  return _step_modify_counter(step, pipe)
		"Summon":         return _step_summon(step, pipe)
		"Move":           return _step_move(step, pipe)
		"Swap":           return _step_swap(step, pipe)
		"MakeAttack":     return _step_make_attack(step, pipe)
		"Attach":         return _step_attach(step, pipe)
		"ExecuteAbility": return _step_execute_ability(step, pipe)
		"AutoPlay":       return _step_auto_play(step, pipe)
		"PlayCard":       return _step_play_card(step, pipe)
		_:                return "OK"

# ══════════════════════════════
#  TARGET GATHERING
# ══════════════════════════════

func _gather_zone_candidates(owner: String, zone_name: String, condition: String, pipe) -> Array:
	var pool: Array = []
	if owner == "Ally" or owner == "Any":
		pool.append_array(_get_player_zone_cards(0, zone_name))
	if owner == "Enemy" or owner == "Any":
		pool.append_array(_get_player_zone_cards(1, zone_name))
	if condition.is_empty():
		return pool
	# Handle "in:ref" clause — filter pool to only cards present in a pipe array
	var remaining_clauses: String = condition
	for raw in condition.split(","):
		var clause := raw.strip_edges()
		if clause.begins_with("in:"):
			var ref_str := clause.substr(3)
			var arr = pipe.resolve_ref(ref_str)
			if arr is Array:
				pool = pool.filter(func(card): return card in arr)
			elif arr != null:
				pool = pool.filter(func(card): return card == arr)
			remaining_clauses = remaining_clauses.replace(raw, "")
	# Clean up remaining clauses (remove empty segments from stripped "in:" clause)
	var parts: Array = Array(remaining_clauses.split(",")).filter(func(s): return s.strip_edges() != "")
	var cleaned: String = ",".join(PackedStringArray(parts))
	if cleaned.is_empty():
		return pool
	var context := {"source_card": pipe.source_card, "source_unit": pipe.source_unit}
	return pool.filter(func(card): return ConditionEvaluatorScript.card_matches(card, cleaned, context))

func _gather_board_candidates(_target_type: String, owner: String, condition: String, tgt_range: int, pipe) -> Array:
	var candidates: Array = []
	for row in range(gm.GRID_ROWS):
		for col in range(gm.GRID_COLS):
			var unit = gm.grid[row][col]
			if unit == null:
				continue
			# Owner filter
			match owner:
				"Ally":
					if unit.owner_id != 0:
						continue
				"Enemy":
					if unit.owner_id == 0:
						continue
			# Range filter
			if tgt_range > 0 and pipe.source_unit != null:
				var dist: int = absi(unit.grid_row - pipe.source_unit.grid_row) + absi(unit.grid_col - pipe.source_unit.grid_col)
				if dist > tgt_range:
					continue
			# Condition filter
			var context := {"source_card": pipe.source_card, "source_unit": pipe.source_unit}
			if not ConditionEvaluatorScript.unit_matches(unit, condition, context):
				continue
			candidates.append(unit)
	return candidates

func _get_player_zone_cards(player_id: int, zone_name: String) -> Array:
	match zone_name:
		"deck":
			return gm.player_deck.duplicate() if player_id == 0 else _resolve_enemy_ids(gm.enemy_deck_ids)
		"hand":
			return gm.player_hand.duplicate() if player_id == 0 else _resolve_enemy_ids(gm.enemy_hand_ids)
		"graveyard", "discard":
			return gm.player_discard.duplicate() if player_id == 0 else _resolve_enemy_ids(gm.enemy_discard_ids)
		"pile":
			return gm.player_pile.duplicate() if player_id == 0 else _resolve_enemy_ids(gm.enemy_pile_ids)
		"exile":
			return gm.player_exile.duplicate() if player_id == 0 else []
	return []

func _resolve_enemy_ids(ids: Array) -> Array:
	var result: Array = []
	for cid in ids:
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			result.append(card)
	return result

# ══════════════════════════════
#  ASYNC TARGET PICKERS
# ══════════════════════════════

func _async_pick_from_board(step, pipe, candidates: Array, prompt_text: String) -> String:
	gm._awaiting_target = true
	gm._target_valid = "UNIT"
	gm._target_valid_2 = "ANY"
	gm._target_valid_3 = ""
	gm._target_range = 99
	gm._target_source_row = -1
	gm._target_source_col = -1
	gm._target_use_source = false
	gm._target_callback = func(row: int, col: int) -> void:
		gm._awaiting_target = false
		var picked = null
		for c in candidates:
			if c.has_method("is_alive") and c.grid_row == row and c.grid_col == col:
				picked = c
				break
		if picked == null:
			_log("⚠ Érvénytelen célpont!")
			_resume_chain()
			return
		pipe.store_value("__inline_target__", picked)
		var original_ref: String = step.target_ref
		step.target_ref = "__inline_target__"
		var result: String = _execute_step_inner(step, pipe)
		step.target_ref = original_ref
		if result != "ASYNC":
			_resume_chain()
	gm.target_requested.emit(gm._target_valid, gm._target_range, gm._target_source_row, gm._target_source_col, gm._target_callback)
	if prompt_text.is_empty():
		prompt_text = "Válassz célpontot!"
	_log("⚡ %s" % prompt_text)
	return "ASYNC"

func _async_pick_from_cards(step, pipe, candidates: Array, prompt_text: String, count: int) -> String:
	if prompt_text.is_empty():
		prompt_text = "Válassz egy lapot!"
	var step_ref = step
	gm.search_pick_requested.emit(candidates, count, prompt_text, func(selected: Array) -> void:
		if selected.size() > 0:
			pipe.store_value("__inline_target__", selected[0] if selected.size() == 1 else selected)
		var original_ref: String = step_ref.target_ref
		step_ref.target_ref = "__inline_target__"
		var result: String = _execute_step_inner(step_ref, pipe)
		step_ref.target_ref = original_ref
		if result != "ASYNC":
			_resume_chain()
	)
	_log("⚡ %s" % prompt_text)
	return "ASYNC"

# ══════════════════════════════
#  HELPERS
# ══════════════════════════════

## Resolve targets from step.target_ref into an array.
func _resolve_targets(step, pipe) -> Array:
	var ref: String = step.target_ref
	var target = pipe.resolve_ref(ref)
	if target == null:
		# Fallback to trigger interactors
		target = pipe.resolve_ref("INITIAL_TARGET")
	if target is Array:
		return target
	if target != null:
		return [target]
	return []

## Resolve zone cards from step.target_ref (for Draw, Search, Reveal).
func _resolve_zone_cards(step, pipe) -> Array:
	if step.target_ref != "":
		var target = pipe.resolve_ref(step.target_ref)
		if target is Array:
			return target
		elif target != null:
			return [target]
	# Fallback to parameters
	var zone_name: String = String(step.parameters.get("OriginZone", step.parameters.get("SearchZone", step.parameters.get("DrawZone", ""))))
	if zone_name != "":
		var result: Array = []
		for z in zone_name.split(","):
			result.append_array(_get_zone_by_name(z.strip_edges()))
		return result
	return []

func _get_zone_by_name(zone: String) -> Array:
	match zone:
		"MyDeck", "MY_DECK":       return gm.player_deck
		"MyHand", "MY_HAND":       return gm.player_hand
		"MyDiscard", "MY_DISCARD": return gm.player_discard
		"MyPile", "MY_PILE":       return gm.player_pile
		"MyExile", "MY_EXILE":     return gm.player_exile
		"SideDeck":                return gm.player_side_deck
		"EnemyHand", "ENEMY_HAND": return _resolve_enemy_ids(gm.enemy_hand_ids)
		"EnemyDeck", "ENEMY_DECK": return _resolve_enemy_ids(gm.enemy_deck_ids)
		"EnemyDiscard", "ENEMY_DISCARD": return _resolve_enemy_ids(gm.enemy_discard_ids)
		"EnemyPile", "ENEMY_PILE": return _resolve_enemy_ids(gm.enemy_pile_ids)
		"AllCards", "CATALOGUE":   return CardDatabaseScript.get_all_cards()
	return []

## Pick the first matching card from an array, optionally removing it.
func _pick_from_array(source: Array, filter_str: String, pipe, remove: bool = false):
	var context := {"source_card": pipe.source_card, "source_unit": pipe.source_unit}
	# Search from top (end) to bottom (start) — deck convention
	for idx in range(source.size() - 1, -1, -1):
		var card = source[idx]
		if ConditionEvaluatorScript.card_matches(card, filter_str, context):
			if remove:
				source.remove_at(idx)
			return card
	return null

## Filter cards by condition string.
func _filter_cards(cards: Array, filter_str: String, pipe) -> Array:
	if filter_str.is_empty():
		return cards.duplicate()
	var context := {"source_card": pipe.source_card, "source_unit": pipe.source_unit}
	return cards.filter(func(card): return ConditionEvaluatorScript.card_matches(card, filter_str, context))

## Remove a card from any ally zone. Returns the zone name.
func _find_and_remove_from_zones(card) -> String:
	var idx: int = gm.player_hand.find(card)
	if idx >= 0:
		gm.player_hand.remove_at(idx)
		gm.hand_updated.emit()
		return "MyHand"
	idx = gm.player_deck.find(card)
	if idx >= 0:
		gm.player_deck.remove_at(idx)
		return "MyDeck"
	idx = gm.player_discard.find(card)
	if idx >= 0:
		gm.player_discard.remove_at(idx)
		return "MyDiscard"
	idx = gm.player_pile.find(card)
	if idx >= 0:
		gm.player_pile.remove_at(idx)
		return "MyPile"
	if card.get("card_id"):
		var cid: int = int(card.card_id)
		idx = gm.enemy_hand_ids.find(cid)
		if idx >= 0:
			gm.enemy_hand_ids.remove_at(idx)
			gm.enemy_hand_count = gm.enemy_hand_ids.size()
			return "EnemyHand"
		idx = gm.enemy_deck_ids.find(cid)
		if idx >= 0:
			gm.enemy_deck_ids.remove_at(idx)
			return "EnemyDeck"
	return ""

func _remove_card_from_any_zone(card) -> void:
	_find_and_remove_from_zones(card)

func _add_to_zone_by_name(card, zone_name: String, is_robbery: bool = false) -> void:
	if card == null:
		return
	# Tag stolen cards for Zsalu's CONTINUOUS ability
	if is_robbery and card.get("tags") is Array and "stolen" not in card.tags:
		card.tags.append("stolen")
	var robbery_mod: int = _get_robbery_cost_modifier() if is_robbery else 0
	match zone_name:
		"MyHand":
			if robbery_mod != 0 and card.get("cost") != null:
				card.cost = maxi(0, card.cost + robbery_mod)
			gm.player_hand.append(card)
			gm.hand_updated.emit()
		"EnemyHand":
			if card.get("card_id"):
				gm.enemy_hand_ids.append(int(card.card_id))
				gm.enemy_hand_count = gm.enemy_hand_ids.size()
		"MyDiscard":
			gm.player_discard.append(card)
		"MyPile":
			gm.player_pile.append(card)
		"MyExile":
			gm.player_exile.append(card)
		"MyDeck":
			gm.player_deck.append(card)
		"MyDeckBottom":
			gm.player_deck.insert(0, card)

func _get_robbery_cost_modifier() -> int:
	for mod in gm.global_modifiers:
		if mod.modifier_type == ModifierScript.ModifierType.COST and mod.scope_filter == "source:robbery":
			return mod.value
	return 0

## Store a step's output interactors in the pipeline.
func _store_output(step, pipe, outputs: Dictionary) -> void:
	if step == null:
		# Direct store (no step context)
		pipe.store_output("", outputs)
		return
	var tag: String = step.tag if step.get("tag") else ""
	# Apply the pipeline tag to every output entity.
	# Keys containing "Zone" or "Results" hold zone references/raw pools — skip them.
	if not tag.is_empty():
		for key in outputs:
			if not ("Zone" in key or "Results" in key):
				_tag_entity(tag, outputs[key])
	pipe.store_output(tag, outputs)

func _get_ability_trigger_event(ab) -> String:
	if ab == null:
		return ""
	var trig = ab.trigger
	if trig == null:
		return ""
	if trig is String:
		return trig
	if trig.get("event") != null:
		return String(trig.event)
	return ""

func _get_game_state():
	# During transition, construct a lightweight proxy.
	# Once GameState is wired into GameManager, this returns gm.state.
	if gm.get("state") != null:
		return gm.state
	return null

func _begins_with_enemy(name: String) -> bool:
	return name.to_lower().begins_with("enemy")

func _begins_with_ally(name: String) -> bool:
	var n := name.to_lower()
	return n.begins_with("my") or n.begins_with("ally")

## Apply the step's pipeline tag to any card or unit entity.
## Skips nulls, empty tags, and primitives (int, String, Vector2i).
## For units, tags the underlying card object.
func _tag_entity(tag: String, entity) -> void:
	if tag.is_empty() or entity == null or entity is int or entity is String or entity is Vector2i:
		return
	if entity is Array:
		for item in entity:
			_tag_entity(tag, item)
	elif entity.get("tags") is Array:
		if tag not in entity.tags:
			entity.tags.append(tag)
	elif entity.get("card") != null and entity.card.get("tags") is Array:
		if tag not in entity.card.tags:
			entity.card.tags.append(tag)

func _log_stat_change(target, stat_name: String, amount: int) -> void:
	match stat_name:
		"ATK":
			_log("⚡ %s kap %+d Támadást! (%s)" % [target.get_display_name(), amount, target.get_stats_text()])
		"HP":
			_log("⚡ %s kap %+d Életerőt! (%s)" % [target.get_display_name(), amount, target.get_stats_text()])
		"ATK_HP":
			_log("⚡ %s kap %+d/%+d! (%s)" % [target.get_display_name(), amount, amount, target.get_stats_text()])

func _log(msg: String) -> void:
	if gm and gm.has_signal("game_log"):
		gm.game_log.emit(msg)
