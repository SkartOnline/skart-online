## AbilityTrigger — defines WHEN an ability activates.
## Part of the Trigger/Target/Effect architecture.
class_name AbilityTrigger
extends Resource

## ========== TRIGGER EVENTS ==========
const Event := {
	ON_PLAY = "ON_PLAY",
	CONTINUOUS = "CONTINUOUS",
	ON_TURN_START = "ON_TURN_START",
	ON_TURN_END = "ON_TURN_END",
	ON_DEATH = "ON_DEATH",
	ON_EXILE = "ON_EXILE",
	ON_ATTACK = "ON_ATTACK",
	ON_ATTACK_KILL = "ON_ATTACK_KILL",
	ON_KILL = "ON_KILL",
	ON_DEFENSE = "ON_DEFENSE",
	ON_TAKE_DAMAGE = "ON_TAKE_DAMAGE",
	ON_HEAL = "ON_HEAL",
	ON_MOVE = "ON_MOVE",
	ON_COUNTER_CHANGE = "ON_COUNTER_CHANGE",
	ON_COUNTER_COUNT = "ON_COUNTER_COUNT",
	ON_SPELL_ATTACHED = "ON_SPELL_ATTACHED",
	ON_WEAPON_ATTACHED = "ON_WEAPON_ATTACHED",
	ON_ENTERS_TILE = "ON_ENTERS_TILE",
	ACTIVATED = "ACTIVATED",
	ON_DISCARDED = "ON_DISCARDED",
	ON_DRAW = "ON_DRAW",
	ON_ADJACENCY = "ON_ADJACENCY",
	ON_TRANSFORM = "ON_TRANSFORM",
	ON_TIMER = "ON_TIMER",
	ON_ABILITY = "ON_ABILITY",
}

## ========== MODIFIER 1 — scope/ownership ==========
const Modifier1 := {
	SELF = "SELF",
	ALLY = "ALLY",
	ENEMY = "ENEMY",
	ANY = "ANY",
}

## ========== MODIFIER 2 — card type filter ==========
const Modifier2 := {
	NONE = "None",
	UNIT = "Unit",
	SPELL = "Spell",
	WEAPON = "Weapon",
	TRAP = "Trap",
	FORCE_OF_NATURE = "ForceOfNature",
	CHARACTER = "Character",
}

## ========== TRIGGER LIMIT ==========
const LimitType := {
	NONE = "NONE",
	PER_TURN = "PER_TURN",
	PER_GAME = "PER_GAME",
}

## ========== TRIGGER INTERACTORS ==========
## Lookup table: event → array of interactor names auto-populated in ExecutionContext.
## These are NOT stored per-ability; they're derived from the event type.
const TRIGGER_INTERACTORS := {
	"ON_PLAY": ["PlayedCard"],
	"CONTINUOUS": [],
	"ON_TURN_START": [],
	"ON_TURN_END": [],
	"ON_DEATH": ["DiedUnit"],
	"ON_EXILE": ["ExiledUnit"],
	"ON_ATTACK": ["AttackingUnit", "AttackedUnit"],
	"ON_ATTACK_KILL": ["AttackingUnit", "AttackedUnit"],
	"ON_KILL": ["KillingUnit", "KilledUnit"],
	"ON_DEFENSE": ["AttackingUnit", "AttackedEntity"],
	"ON_TAKE_DAMAGE": ["DamageTakingEntity", "SourceOfDamage"],
	"ON_HEAL": ["HealedEntity", "HealingEntity"],
	"ON_MOVE": ["MovedEntity", "MoverEntity"],
	"ON_COUNTER_CHANGE": ["CardWithCounters", "CounterChanger"],
	"ON_COUNTER_COUNT": ["CardWithCounters"],
	"ON_SPELL_ATTACHED": ["HostUnit", "AttachedSpell"],
	"ON_WEAPON_ATTACHED": ["HostUnit", "AttachedWeapon"],
	"ON_ENTERS_TILE": ["EnteringUnit"],
	"ACTIVATED": [],
	"ON_DISCARDED": ["DiscardedCard"],
	"ON_DRAW": ["DrawingPlayer", "DrewCard"],
	"ON_ADJACENCY": ["AdjacentCard"],
	"ON_TRANSFORM": ["TransformingUnit", "TransformedUnit"],
	"ON_TIMER": [],
	"ON_ABILITY": ["AbilitySource", "Ability", "AbilityTarget"],
}

## ========== TRIGGER PARAMETERS ==========
## Lookup table: event → array of parameter names that can be checked.
const TRIGGER_PARAMETERS := {
	"ON_TAKE_DAMAGE": ["DamageTaken"],
	"ON_HEAL": ["DamageHealed"],
	"ON_MOVE": ["TilesMoved"],
	"ON_COUNTER_CHANGE": ["CounterType", "ChangeAmount"],
	"ON_COUNTER_COUNT": ["CounterType", "CounterCount"],
	"ON_ADJACENCY": ["AdjacentCardCount"],
	"ON_TIMER": ["TurnTimer"],
	"ACTIVATED": ["Cost", "CostResource"],
}

## ========== PROPERTIES ==========

@export var event: String = Event.ON_PLAY

@export var modifier1: String = Modifier1.SELF

@export var modifier2: String = Modifier2.NONE

## Key-value pairs for trigger-specific conditions.
## e.g. {"DamageTaken": 3} means "only fire when damage taken >= 3"
@export var parameters: Dictionary = {}

## Global game-state condition checked before the ability fires.
## e.g. "player_hp < 10" or "ally_unit_count < enemy_unit_count"
@export var game_state_condition: String = ""

## Interactor-scoped trigger conditions.
## Key = interactor name, value = condition string checked on that interactor.
## e.g. {"PlayedCard": "tag:Tűz,cost<=2", "KillingUnit": "tag:Kalóz"}
@export var trigger_interactors: Dictionary = {}

@export var limit_type: String = LimitType.NONE

@export var limit_count: int = 0

## ========== METHODS ==========

## ── Core matching: does this trigger fire for the given event + context? ──
## context keys expected:
##   played_card, played_unit, killed_unit, killer, discarded_card,
##   defender, target, discards_this_turn, event_source_owner (int)
## owner_card: the card resource that owns this ability
## owner_unit: the UnitInstance that owns this ability (null for hand/character)
## gm: GameManager reference (for game-state condition evaluation)
## limit_counts: Dictionary tracking PER_TURN/PER_GAME counts (managed by AbilityQueue)
func matches(event_name: String, context: Dictionary, owner_card, owner_unit, gm = null, limit_counts: Dictionary = {}) -> bool:
	# 1) Event must match
	if event != event_name:
		return false

	# 2) modifier1 — scope/ownership filter
	if not _matches_modifier1(context, owner_card, owner_unit):
		return false

	# 3) modifier2 — card type filter on event source
	if not _matches_modifier2(context):
		return false

	# 4) PER_TURN / PER_GAME limit
	if not _check_limits(owner_card, limit_counts):
		return false

	# 5) Interactor conditions
	if not _check_interactor_conditions(context, owner_card, owner_unit):
		return false

	# 6) Game-state condition
	if not game_state_condition.is_empty() and gm != null:
		if not _evaluate_game_state_condition(game_state_condition, context, owner_unit, gm):
			return false

	return true

## Increment the limit counter AFTER confirming the ability will fire.
## Call this only when the ability is actually queued for execution.
func consume_limit(owner_card, limit_counts: Dictionary) -> void:
	if limit_type == LimitType.NONE:
		return
	var limit_key := _limit_key(owner_card)
	var current: int = limit_counts.get(limit_key, 0)
	limit_counts[limit_key] = current + 1

## ── modifier1: scope/ownership matching ──
func _matches_modifier1(context: Dictionary, owner_card, owner_unit) -> bool:
	match modifier1:
		Modifier1.SELF:
			# SELF: fires only when THIS card is the event source
			var played_card = context.get("played_card")
			var _played_unit = context.get("played_unit")
			# For ON_DEATH, ON_KILL etc. the "source" identity differs
			match event:
				Event.ON_PLAY:
					if played_card == null:
						return false
					return played_card == owner_card
				Event.ON_DEATH:
					# ON_DEATH SELF means the dying unit's own ability
					var killed_unit = context.get("killed_unit")
					if killed_unit != null and owner_unit != null:
						return killed_unit == owner_unit
					# Fallback: card identity
					var died_card = context.get("died_card", context.get("played_card"))
					return died_card != null and died_card == owner_card
				Event.ON_ATTACK:
					# ON_ATTACK SELF: the attacking unit's own ability
					var attacker = context.get("attacker", context.get("played_unit"))
					if attacker != null and owner_unit != null:
						return attacker == owner_unit
					return false
				Event.ON_KILL:
					# ON_KILL SELF: the killing unit's own ability
					var killer = context.get("killer")
					if killer != null and owner_unit != null:
						return killer == owner_unit
					return false
				Event.ACTIVATED:
					# SELF: only fires for the card that was actually activated
					var activated_card = context.get("played_card")
					if activated_card != null:
						return activated_card == owner_card
					return true
				Event.ON_TURN_START, Event.ON_TURN_END:
					# SELF is always true for self-scoped periodic triggers
					return true
				_:
					# Generic SELF: check played_card == owner_card
					if played_card != null:
						return played_card == owner_card
					return true

		Modifier1.ALLY:
			# ALLY: fires for same-owner events, but NOT for self
			var source_owner: int = context.get("event_source_owner", 0)
			if source_owner != 0:
				return false
			# Exclude self
			return not _is_self_source(context, owner_card, owner_unit)

		Modifier1.ENEMY:
			# ENEMY: fires for opponent's events
			var source_owner_e: int = context.get("event_source_owner", 0)
			return source_owner_e != 0

		Modifier1.ANY:
			# ANY: fires for any source (may still need to exclude self depending on event)
			return true

	return true

## ── modifier2: card type filter ──
func _matches_modifier2(context: Dictionary) -> bool:
	if modifier2 == Modifier2.NONE or modifier2 == "":
		return true
	var played_card = context.get("played_card")
	if played_card == null:
		return true  # No card to filter; pass through
	var CardScript = preload("res://scripts/cards/card.gd")
	match modifier2:
		Modifier2.UNIT:
			return played_card.card_type == CardScript.CardType.UNIT
		Modifier2.SPELL:
			return played_card.card_type == CardScript.CardType.SPELL
		Modifier2.CHARACTER:
			return played_card.card_type == CardScript.CardType.CHARACTER
		Modifier2.WEAPON:
			return played_card.card_type == CardScript.CardType.WEAPON
	return true

## ── Check if the event source is self ──
func _is_self_source(context: Dictionary, owner_card, owner_unit) -> bool:
	var played_card = context.get("played_card")
	var played_unit = context.get("played_unit")
	if played_unit != null and owner_unit != null:
		return played_unit == owner_unit
	if played_card != null and owner_card != null:
		return played_card == owner_card
	# For kill/death events, check the relevant interactor
	var killer = context.get("killer")
	if killer != null and owner_unit != null:
		return killer == owner_unit
	var killed_unit = context.get("killed_unit")
	if killed_unit != null and owner_unit != null:
		return killed_unit == owner_unit
	return false

## ── PER_TURN / PER_GAME limits ──
func _limit_key(owner_card) -> String:
	var card_id_str := str(owner_card.card_id) if owner_card != null and owner_card.get("card_id") else str(get_instance_id())
	return "trigger_limit_%s_%s" % [event, card_id_str]

func _check_limits(owner_card, limit_counts: Dictionary) -> bool:
	if limit_type == LimitType.NONE:
		return true
	if limit_count <= 0:
		return true
	var key := _limit_key(owner_card)
	var current: int = limit_counts.get(key, 0)
	return current < limit_count

## ── Interactor conditions ──
func _check_interactor_conditions(context: Dictionary, owner_card, owner_unit) -> bool:
	if trigger_interactors.is_empty():
		return true
	for interactor_name in trigger_interactors.keys():
		var cond_str: String = String(trigger_interactors[interactor_name])
		if cond_str.is_empty():
			continue
		var interactor_obj = _resolve_interactor_from_context(String(interactor_name), context)
		if interactor_obj == null:
			return false
		if not _evaluate_interactor_condition(interactor_obj, cond_str, owner_card, owner_unit, context):
			return false
	return true

## ── Resolve interactor from context ──
func _resolve_interactor_from_context(name: String, context: Dictionary):
	match name:
		"PlayedCard":
			return context.get("played_card")
		"PlayedUnit":
			return context.get("played_unit")
		"AttackedUnit":
			return context.get("defender", context.get("target"))
		"AttackingUnit":
			return context.get("attacker", context.get("played_unit"))
		"KillingUnit":
			return context.get("killer")
		"KilledUnit":
			return context.get("killed_unit")
		"DiedUnit":
			return context.get("killed_unit", context.get("died_unit"))
		"DiscardedCard":
			return context.get("discarded_card")
		_:
			return context.get(name)

## ── Evaluate a single interactor condition string (comma-separated parts) ──
func _evaluate_interactor_condition(interactor, cond_text: String, owner_card, owner_unit, context: Dictionary) -> bool:
	var CardScript2 = preload("res://scripts/cards/card.gd")
	for raw_part in cond_text.split(","):
		var part := raw_part.strip_edges()
		if part.is_empty():
			continue
		var interactor_card = interactor.card if interactor != null and interactor.get("card") else interactor
		if part == "SELF":
			continue
		if part == "not_self":
			if _is_self_source(context, owner_card, owner_unit):
				return false
			continue
		if part.begins_with("tag:"):
			var tag := part.substr(4)
			if interactor_card == null or not interactor_card.get("tags") or not (tag in interactor_card.tags):
				return false
		elif part.begins_with("school:"):
			var school := part.substr(7)
			if interactor_card == null or String(interactor_card.get("school", "")) != school:
				return false
		elif part.begins_with("type:"):
			var t := part.substr(5).to_upper()
			if interactor_card == null:
				return false
			if t == "UNIT" and interactor_card.card_type != CardScript2.CardType.UNIT:
				return false
			if t == "SPELL" and interactor_card.card_type != CardScript2.CardType.SPELL:
				return false
			if t == "CHARACTER" and interactor_card.card_type != CardScript2.CardType.CHARACTER:
				return false
		elif part == "damaged":
			if interactor == null or not interactor.has_method("is_alive"):
				return false
			if not interactor.is_damaged():
				return false
		elif part.begins_with("cost"):
			if interactor_card == null or interactor_card.get("cost", null) == null:
				return false
			var interactor_cost: int = int(interactor_card.cost)
			if part.find("<=") != -1:
				var rhs := part.split("<=", false, 1)[1].strip_edges()
				if rhs.is_valid_int() and interactor_cost > int(rhs):
					return false
			elif part.find(">=") != -1:
				var rhs := part.split(">=", false, 1)[1].strip_edges()
				if rhs.is_valid_int() and interactor_cost < int(rhs):
					return false
			elif part.find("<") != -1:
				var rhs := part.split("<", false, 1)[1].strip_edges()
				if rhs.is_valid_int() and interactor_cost >= int(rhs):
					return false
			elif part.find(">") != -1:
				var rhs := part.split(">", false, 1)[1].strip_edges()
				if rhs.is_valid_int() and interactor_cost <= int(rhs):
					return false
			elif part.find(":") != -1:
				var rhs := part.split(":", false, 1)[1].strip_edges()
				if rhs.is_valid_int() and interactor_cost != int(rhs):
					return false
	return true

## ── Evaluate game-state condition ──
func _evaluate_game_state_condition(cond: String, context: Dictionary, _unit, gm) -> bool:
	for raw_cond in cond.split(","):
		var part := raw_cond.strip_edges()
		if part.is_empty():
			continue
		# Hand count conditions
		var hand_result = _try_eval_hand_count(part, gm)
		if hand_result != null:
			if not bool(hand_result):
				return false
			continue
		# Pattern: "played_card.tag:Kalóz"
		if part.begins_with("played_card.tag:"):
			var tag: String = part.substr(16)
			var played = context.get("played_card")
			if played == null or not (played.get("tags") and tag in played.tags):
				return false
		elif part.begins_with("played_card.type:"):
			var type_name: String = part.substr(17)
			var played2 = context.get("played_card")
			if played2 == null:
				return false
			var CardScript3 = preload("res://scripts/cards/card.gd")
			match type_name:
				"UNIT":
					if played2.card_type != CardScript3.CardType.UNIT:
						return false
				"SPELL":
					if played2.card_type != CardScript3.CardType.SPELL:
						return false
		elif part == "PlayedCard != SELF" or part == "not_self":
			var played_unit = context.get("played_unit")
			if played_unit != null and _unit != null and played_unit == _unit:
				return false
		elif part == "AttackedUnit.damaged" or part == "target.damaged":
			var target_unit = context.get("defender", context.get("target"))
			if target_unit == null or not target_unit.has_method("is_alive"):
				return false
			if not target_unit.is_damaged():
				return false
		elif part == "first_discard_per_turn":
			var discards: int = context.get("discards_this_turn", 0)
			if gm != null:
				discards = gm._discards_this_turn if discards == 0 else discards
			if discards != 1:
				return false
		elif part.begins_with("killer.tag:"):
			var killer_tag: String = part.substr(11)
			var killer = context.get("killer")
			if killer == null or killer.card == null:
				return false
			if not (killer.card.get("tags") and killer_tag in killer.card.tags):
				return false
		elif part == "has_ally_unit_cost_lt_played":
			# True if at least one ally unit on the board has cost < played_card.cost
			var played_c = context.get("played_card")
			if played_c == null or played_c.get("cost") == null:
				return false
			var found := false
			for r in range(gm.GRID_ROWS):
				for c in range(gm.GRID_COLS):
					var u = gm.grid[r][c]
					if u != null and u.owner_id == 0 and u.card != null and u.card.get("cost") != null:
						if int(u.card.cost) < int(played_c.cost):
							found = true
							break
				if found:
					break
			if not found:
				return false
	return true

## ── Hand count sub-evaluator ──
func _try_eval_hand_count(expr: String, gm) -> Variant:
	if gm == null:
		return null
	var normalized := expr.strip_edges().replace(" ", "").to_lower()
	if normalized.is_empty():
		return null
	var enemy_count: int = gm.enemy_hand_count if not gm.mp_mode else gm.enemy_hand_ids.size()
	var lhs_values := {
		"ally_hand.cardcount": gm.player_hand.size(),
		"my_hand_count": gm.player_hand.size(),
		"ally_hand_count": gm.player_hand.size(),
		"enemy_hand.cardcount": enemy_count,
		"enemy_hand_count": enemy_count,
	}
	for lhs in lhs_values.keys():
		if not normalized.begins_with(lhs):
			continue
		var rest := normalized.substr(lhs.length())
		var op := ""
		if rest.begins_with("=="):
			op = "=="
			rest = rest.substr(2)
		elif rest.begins_with("!="):
			op = "!="
			rest = rest.substr(2)
		elif rest.begins_with("<="):
			op = "<="
			rest = rest.substr(2)
		elif rest.begins_with(">="):
			op = ">="
			rest = rest.substr(2)
		elif rest.begins_with("<"):
			op = "<"
			rest = rest.substr(1)
		elif rest.begins_with(">"):
			op = ">"
			rest = rest.substr(1)
		elif rest.begins_with("="):
			op = "="
			rest = rest.substr(1)
		if op == "" or not rest.is_valid_int():
			return false
		var lhs_val: int = int(lhs_values[lhs])
		var rhs_val: int = int(rest)
		match op:
			"=", "==":
				return lhs_val == rhs_val
			"!=":
				return lhs_val != rhs_val
			"<":
				return lhs_val < rhs_val
			"<=":
				return lhs_val <= rhs_val
			">":
				return lhs_val > rhs_val
			">=":
				return lhs_val >= rhs_val
		return false
	return null

func get_interactor_names() -> Array:
	return TRIGGER_INTERACTORS.get(event, [])

func get_parameter_names() -> Array:
	return TRIGGER_PARAMETERS.get(event, [])

func get_display_name() -> String:
	match event:
		Event.ON_PLAY: return "Csatakiáltás" if modifier1 == Modifier1.SELF else "Kijátszáskor"
		Event.CONTINUOUS: return "Folyamatos"
		Event.ON_TURN_START: return "Hajnal"
		Event.ON_TURN_END: return "Alkony"
		Event.ON_DEATH: return "Halál"
		Event.ON_ATTACK: return "Támadáskor"
		Event.ON_KILL: return "Öléskor"
		Event.ON_TAKE_DAMAGE: return "Sebződéskor"
		Event.ON_HEAL: return "Gyógyításkor"
		Event.ON_MOVE: return "Mozgáskor"
		Event.ON_DRAW: return "Húzáskor"
		Event.ON_DISCARDED: return "Eldobáskor"
		Event.ON_SPELL_ATTACHED: return "Varázslat csatolásakor"
		Event.ON_WEAPON_ATTACHED: return "Fegyver csatolásakor"
		Event.ON_ENTERS_TILE: return "Mezőre lépéskor"
		Event.ACTIVATED: return "Aktiválható"
		Event.ON_ADJACENCY: return "Szomszédosság"
		Event.ON_TRANSFORM: return "Átváltozáskor"
		Event.ON_TIMER: return "Időzítő"
		Event.ON_ABILITY: return "Képesség használatakor"
		_: return event
