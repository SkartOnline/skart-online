## EffectPipeline — manages the flow of data between effect steps.
## Each step's outputs are stored and can be referenced by subsequent steps.
## Replaces ExecutionContext's mixed tag/interactor/legacy store system.
##
## Usage:
##   var pipe = EffectPipeline.new()
##   pipe.set_trigger_interactor("PlayedCard", card)
##   pipe.store_output("my_draw", { "DrawnCard": drawn_cards })
##   var val = pipe.resolve_ref("my_draw.DrawnCard")  # → drawn_cards
class_name EffectPipeline
extends RefCounted

## Trigger interactors — auto-populated when the trigger fires.
## e.g. {"PlayedCard": card, "AttackingUnit": unit, "AttackedUnit": unit}
var trigger_interactors: Dictionary = {}

## Step outputs — keyed by step tag.
## e.g. {"my_draw": {"DrawnCard": [card1, card2]}, "search_1": {"SearchResults": [...]}}
var step_outputs: Dictionary = {}

## Resolved primary targets from Ability.targets blocks.
## Accessed via "targets[0]", "targets[1]", etc.
var resolved_targets: Array = []

## The unit that owns this ability (null for character/spell abilities).
var source_unit = null  ## UnitInstance or null

## The card resource that owns this ability.
var source_card = null  ## Resource (CharacterCard/UnitCard/SpellCard)

## Owner player id (0 = local, 1 = opponent).
var owner_id: int = 0

## Current item in FOR_EACH iteration.
var current_item = null

## Raw trigger context from GameManager (for backward compat during transition).
var trigger_context: Dictionary = {}

## Per-turn counters shared across abilities in one turn.
var counters: Dictionary = {}

# ── Trigger interactors ──

func set_trigger_interactor(name: String, val) -> void:
	trigger_interactors[name] = val

func get_trigger_interactor(name: String):
	return trigger_interactors.get(name, null)

# ── Step output storage ──

## Store an effect step's outputs under a tag.
## outputs: Dictionary mapping interactor names to values.
## e.g. store_output("exile_step", {"ExiledUnit": unit})
func store_output(tag: String, outputs: Dictionary) -> void:
	if tag.is_empty():
		# Still store untagged outputs for immediate access by next step
		for key in outputs:
			step_outputs[key] = outputs[key]
		return
	step_outputs[tag] = outputs
	# Also store each output at top level for unqualified access
	for key in outputs:
		step_outputs[key] = outputs[key]

## Store a single named value (shorthand).
func store_value(name: String, val, tag: String = "") -> void:
	step_outputs[name] = val
	if not tag.is_empty():
		if not step_outputs.has(tag):
			step_outputs[tag] = {}
		if step_outputs[tag] is Dictionary:
			step_outputs[tag][name] = val
		# Also store qualified name
		step_outputs[tag + "." + name] = val

# ── Reference resolution ──

## Resolve a reference string to an actual object.
##
## Supported formats:
##   "targets[N]"        — primary ability targets
##   "PlayedCard"         — trigger interactor
##   "my_tag.DrawnCard"   — tagged step output
##   "DrawnCard"          — untagged step output (most recent)
##   "SELF"               — source unit
##   "SELF_CARD"          — source card
##   "SELF_OWNER"         — owner player id
##   "OPPONENT"           — opponent player id
##   "CURRENT"            — current FOR_EACH item
##   "__inline_target__"  — inline target (internal)
func resolve_ref(ref: String):
	if ref.is_empty():
		return null

	# Primary targets: "targets[0]", "targets[1]"
	if ref.begins_with("targets["):
		var idx_str := ref.substr(8, ref.length() - 9)
		if idx_str.is_valid_int():
			var idx := int(idx_str)
			if idx >= 0 and idx < resolved_targets.size():
				return resolved_targets[idx]
		return null

	# Built-in refs
	match ref:
		"SELF":
			return source_unit
		"SELF_CARD":
			return source_card
		"SELF_OWNER":
			return owner_id
		"OPPONENT":
			return 1 if owner_id == 0 else 0
		"CURRENT":
			return current_item

	# Trigger interactors
	if trigger_interactors.has(ref):
		return trigger_interactors[ref]

	# Step outputs — try direct key first
	if step_outputs.has(ref):
		return step_outputs[ref]

	# Dotted reference: "tag.InteractorName" or "tag.Key[N]"
	if ref.contains("."):
		var dot_pos := ref.find(".")
		var tag_part := ref.substr(0, dot_pos)
		var key_part := ref.substr(dot_pos + 1)
		var qualified := ref  # "tag.key"
		if step_outputs.has(qualified):
			return step_outputs[qualified]
		if step_outputs.has(tag_part) and step_outputs[tag_part] is Dictionary:
			var dict_val: Dictionary = step_outputs[tag_part]
			# Handle array indexing within dotted ref: "tag.Key[N]"
			var bk := key_part.find("[")
			if bk > 0:
				var dict_key := key_part.substr(0, bk)
				var close := key_part.find("]", bk)
				if close > bk and dict_val.has(dict_key):
					var arr = dict_val[dict_key]
					var idx_s := key_part.substr(bk + 1, close - bk - 1)
					if arr is Array and idx_s.is_valid_int():
						var idx := int(idx_s)
						if idx >= 0 and idx < arr.size():
							return arr[idx]
					return null
			return dict_val.get(key_part)

	# Array indexing: "ref_name[N]"
	var bracket_pos := ref.find("[")
	if bracket_pos > 0:
		var close := ref.find("]", bracket_pos)
		if close > bracket_pos:
			var base := ref.substr(0, bracket_pos)
			var idx_str := ref.substr(bracket_pos + 1, close - bracket_pos - 1)
			var base_val = resolve_ref(base)
			if base_val is Array and idx_str.is_valid_int():
				var idx := int(idx_str)
				if idx >= 0 and idx < base_val.size():
					return base_val[idx]
			return null

	# Legacy: check trigger_context
	if trigger_context.has(ref):
		return trigger_context[ref]

	# Also check camelCase → snake_case trigger context keys
	var snake := _to_snake_case(ref)
	if trigger_context.has(snake):
		return trigger_context[snake]

	return null

## Resolve a parameter value to an integer.
## Supports:
##   integer literal: "3"
##   ref: "DamageTaken"
##   count(ref): "count(my_search.SearchResults)"
##   negation: "-ref"
##   division: "ref/N"
func resolve_param(val) -> int:
	if val is int:
		return val
	if val is float:
		return int(val)
	if val == null:
		return 0
	var s := String(val).strip_edges()
	if s.is_empty():
		return 0
	if s.is_valid_int():
		return int(s)

	# Negation: "-ref"
	if s.begins_with("-"):
		var inner := s.substr(1)
		return -resolve_param(inner)

	# count(ref)
	if s.begins_with("count(") and s.ends_with(")"):
		var ref := s.substr(6, s.length() - 7)
		var arr = resolve_ref(ref)
		return arr.size() if arr is Array else 0

	# Division: "ref/N"
	if s.contains("/"):
		var parts := s.split("/")
		if parts.size() == 2:
			var numerator := resolve_param(parts[0].strip_edges())
			var denominator := resolve_param(parts[1].strip_edges())
			if denominator != 0:
				@warning_ignore("integer_division")
				return int(numerator) / int(denominator)
			return 0

	# Try resolving as a ref
	var resolved = resolve_ref(s)
	if resolved is int:
		return resolved
	if resolved is float:
		return int(resolved)
	if resolved is Array:
		return resolved.size()
	return 0

## Resolve the primary amount from a step's parameters.
## Checks common parameter keys: ModifyAmount, DamageAmount, HealAmount, DrawAmount, etc.
func resolve_amount(step) -> int:
	var params: Dictionary = step.parameters if step.get("parameters") else {}
	for key in ["ModifyAmount", "SetAmount", "DamageAmount", "HealAmount",
				 "DrawAmount", "DiscardAmount", "RevealAmount", "MoveAmount",
				 "SelectAmount", "ShownAmount"]:
		if params.has(key):
			return resolve_param(params[key])
	return 0

# ── Counter operations ──

func increment_counter(key: String, amount: int = 1) -> int:
	var current: int = counters.get(key, 0)
	current += amount
	counters[key] = current
	return current

func get_counter(key: String) -> int:
	return counters.get(key, 0)

# ── Helpers ──

static func _to_snake_case(pascal: String) -> String:
	var result := ""
	for i in range(pascal.length()):
		var ch := pascal[i]
		if ch >= "A" and ch <= "Z" and i > 0:
			result += "_"
		result += ch.to_lower()
	return result
