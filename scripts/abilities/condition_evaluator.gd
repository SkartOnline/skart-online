## ConditionEvaluator — structured evaluation of filter/condition expressions.
## Replaces ad-hoc string parsing in step_executor._evaluate_condition,
## _card_matches_filter, _check_inline_condition, etc.
##
## Condition format: comma-separated clauses, all must pass (AND logic).
## Each clause is one of:
##   property operator value   — e.g. "cost > 2", "hp <= 0"
##   tag:TagName               — has tag
##   school:SchoolName         — has school
##   type:UNIT/SPELL/CHARACTER — card type check
##   keyword:KeywordName       — unit has keyword
##   damaged                   — unit HP < max HP
##   not_self                  — exclude the ability source
##   adjacent                  — adjacent to ability source
##   adjacent_to:ref           — adjacent to a specific ref target
##   has_ability:TriggerEvent  — card has ability with given trigger
##   empty                     — tile is empty (for Area targets)
class_name ConditionEvaluator
extends RefCounted

# ── Card property evaluation ──

## Check if a card matches a condition string.
## card: Resource (Card/UnitCard/SpellCard)
## condition: comma-separated condition string
## context: optional Dictionary for dynamic references
static func card_matches(card, condition: String, context: Dictionary = {}) -> bool:
	if condition.is_empty():
		return true
	if card == null:
		return false
	for raw in condition.split(","):
		var clause := raw.strip_edges()
		if clause.is_empty():
			continue
		if not _eval_card_clause(card, clause, context):
			return false
	return true

## Check if a unit (UnitInstance) matches a condition string.
static func unit_matches(unit, condition: String, context: Dictionary = {}) -> bool:
	if condition.is_empty():
		return true
	if unit == null:
		return false
	for raw in condition.split(","):
		var clause := raw.strip_edges()
		if clause.is_empty():
			continue
		if not _eval_unit_clause(unit, clause, context):
			return false
	return true

# ── Flow condition evaluation ──

## Evaluate a flow condition expression (for conditional/repeat_while).
## pipe: EffectPipeline (for resolving refs)
## game_state: GameState (for game-level queries)
static func evaluate_flow(condition: String, pipe, game_state) -> bool:
	if condition.is_empty():
		return true

	# "has_adjacent_enemy(ref)"
	if condition.begins_with("has_adjacent_enemy("):
		var close := condition.find(")")
		if close > 0:
			var ref: String = condition.substr(19, close - 19)
			var unit = pipe.resolve_ref(ref)
			if unit == null or not unit.has_method("is_alive"):
				return false
			var adj = game_state.arena.adjacent_units(unit.grid_row, unit.grid_col)
			for a in adj:
				if a.owner_id != unit.owner_id:
					return true
			return false

	# "count(ref) op N"
	if condition.begins_with("count("):
		var close_paren := condition.find(")")
		if close_paren > 0:
			var ref: String = condition.substr(6, close_paren - 6)
			var rest: String = condition.substr(close_paren + 1).strip_edges()
			var arr = pipe.resolve_ref(ref)
			var arr_count: int = arr.size() if arr is Array else 0
			return _compare_int(arr_count, rest)

	# "enemy_hand_count > my_hand_count"
	if condition == "enemy_hand_count > my_hand_count":
		return game_state.enemy().hand.size() > game_state.ally().hand.size()

	# "tagged:NAME.property op value"
	if condition.contains(".card_type == "):
		var parts: Array = condition.split(".card_type == ")
		if parts.size() == 2:
			var ref: String = parts[0].strip_edges()
			var expected: String = parts[1].strip_edges()
			var obj = pipe.resolve_ref(ref)
			if obj != null and obj.get("card_type") != null:
				return _check_card_type(obj, expected)
		return false

	# "ref.hp <= 0"
	if condition.contains(".hp <= 0"):
		var ref: String = condition.split(".hp")[0].strip_edges()
		var obj = pipe.resolve_ref(ref)
		if obj != null and obj.has_method("get_effective_hp"):
			return obj.get_effective_hp() <= 0
		return false

	# Default: true (unknown conditions pass with warning)
	return true

# ── Internal clause evaluators ──

static func _eval_card_clause(card, clause: String, context: Dictionary) -> bool:
	# tag:TagName
	if clause.begins_with("tag:"):
		var tag_name := clause.substr(4)
		return card.get("tags") is Array and tag_name in card.tags

	# school:SchoolName
	if clause.begins_with("school:"):
		var school_name := clause.substr(7)
		return card.get("school") != null and String(card.school) == school_name

	# type:UNIT / type:SPELL / type:CHARACTER
	if clause.begins_with("type:"):
		var type_name := clause.substr(5).to_upper()
		return _check_card_type(card, type_name)

	# has_ability:EVENT
	if clause.begins_with("has_ability:"):
		var event := clause.substr(12)
		if card.get("abilities") is Array:
			for ab in card.abilities:
				if ab and ab.get("trigger") and ab.trigger.get("event") == event:
					return true
		return false

	# not_self — exclude ability source card
	if clause == "not_self":
		var source_card = context.get("source_card")
		if source_card != null and card.get("card_id") != null and source_card.get("card_id") != null:
			return int(card.card_id) != int(source_card.card_id)
		return true

	# card_id:N or card_id:ref
	if clause.begins_with("card_id:"):
		var id_part := clause.substr(8)
		if id_part.is_valid_int():
			return card.get("card_id") != null and int(card.card_id) == int(id_part)
		return false

	# Property comparisons: cost>2, cost<=5, atk<3, hp>=1
	# Also supports dynamic refs: cost<PlayedCard.cost
	var resolved_clause := _resolve_dynamic_clause(clause, context)
	var parsed := _parse_comparison(resolved_clause)
	if parsed.size() == 3:
		var prop_name: String = parsed[0]
		var op: String = parsed[1]
		var val: int = parsed[2]
		var card_val = _get_card_property(card, prop_name)
		if card_val != null:
			return _apply_comparison(int(card_val), op, val)

	return true  # Unknown clauses pass

static func _eval_unit_clause(unit, clause: String, context: Dictionary) -> bool:
	# damaged
	if clause == "damaged":
		return unit.is_damaged() if unit.has_method("is_damaged") else false

	# adjacent — adjacent to source
	if clause == "adjacent":
		var source = context.get("source_unit")
		if source == null or not source.has_method("is_alive"):
			return false
		return maxi(absi(unit.grid_row - source.grid_row), absi(unit.grid_col - source.grid_col)) == 1

	# adjacent_to:ref — not resolvable without pipeline, delegate up
	if clause.begins_with("adjacent_to:"):
		var ref_target = context.get("adjacent_target")
		if ref_target != null and ref_target.has_method("is_alive"):
			return maxi(absi(unit.grid_row - ref_target.grid_row), absi(unit.grid_col - ref_target.grid_col)) == 1
		return false

	# keyword:KW
	if clause.begins_with("keyword:"):
		var kw := clause.substr(8)
		return unit.has_keyword(kw) if unit.has_method("has_keyword") else kw in unit.keywords

	# Fall through to card clause (tag, type, cost checks apply to unit.card)
	if unit.get("card") != null:
		return _eval_card_clause(unit.card, clause, context)

	return true

# ── Comparison parsing ──

## Resolve dynamic property refs like PlayedCard.cost to their integer value.
static func _resolve_dynamic_clause(clause: String, context: Dictionary) -> String:
	var played_card = context.get("played_card")
	if played_card != null:
		for prop in ["cost", "attack", "hp", "move_speed", "attack_range"]:
			var dyn_ref: String = "PlayedCard." + prop
			if dyn_ref in clause:
				var val = _get_card_property(played_card, prop)
				if val != null:
					clause = clause.replace(dyn_ref, str(int(val)))
	return clause

## Parse "property op value" → ["property", "op", value:int] or empty array.
static func _parse_comparison(clause: String) -> Array:
	for op in ["<=", ">=", "!=", "==", "<", ">", "="]:
		var pos := clause.find(op)
		if pos > 0:
			var prop := clause.substr(0, pos).strip_edges()
			var val_str := clause.substr(pos + op.length()).strip_edges()
			if val_str.is_valid_int():
				var actual_op: String = "==" if op == "=" else op
				return [prop, actual_op, int(val_str)]
	return []

static func _compare_int(actual: int, rest: String) -> bool:
	rest = rest.strip_edges()
	if rest.begins_with("== "):
		return actual == int(rest.substr(3))
	elif rest.begins_with("!= "):
		return actual != int(rest.substr(3))
	elif rest.begins_with(">= "):
		return actual >= int(rest.substr(3))
	elif rest.begins_with("<= "):
		return actual <= int(rest.substr(3))
	elif rest.begins_with("> "):
		return actual > int(rest.substr(2))
	elif rest.begins_with("< "):
		return actual < int(rest.substr(2))
	return false

static func _apply_comparison(actual: int, op: String, expected: int) -> bool:
	match op:
		"==": return actual == expected
		"!=": return actual != expected
		"<":  return actual < expected
		">":  return actual > expected
		"<=": return actual <= expected
		">=": return actual >= expected
	return false

static func _get_card_property(card, prop_name: String):
	match prop_name.to_lower():
		"cost":   return card.cost if card.get("cost") != null else null
		"atk", "attack": return card.attack if card.get("attack") != null else null
		"hp":     return card.hp if card.get("hp") != null else null
		"move_speed": return card.move_speed if card.get("move_speed") != null else null
		"attack_range": return card.attack_range if card.get("attack_range") != null else null
	return null

static func _check_card_type(card, expected: String) -> bool:
	var ct = card.card_type if card.get("card_type") != null else -1
	match expected.to_lower():
		"unit":      return ct == 1
		"spell":     return ct == 2
		"character": return ct == 0
		"weapon":    return ct == 4
		"trap":      return ct == 5
		"nature_force": return ct == 6
		"inspiration": return ct == 7
		"artifact":  return ct == 8
		"quest":     return ct == 9
		"building":  return ct == 10
	return false
