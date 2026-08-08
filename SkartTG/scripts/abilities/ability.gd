## Ability — core resource for all card effects in Skart 2.
## Uses a strict 3-phase architecture: Trigger (when), Target (who), Effect (what).
class_name Ability
extends Resource

const EffectStepScript = preload("res://scripts/abilities/effect_step.gd")

## Legacy compatibility constants kept while old GameManager targeting code is still present.
const ValidTarget1 := {
	NONE = "NONE",
	UNIT = "UNIT",
	ENTITY = "ENTITY",
	PLAYER = "PLAYER",
	TILE = "TILE",
	AREA = "AREA",
}

const ValidTarget2 := {
	ANY = "ANY",
	ALLY = "ALLY",
	ENEMY = "ENEMY",
}

const TargetingMode := {
	AUTOMATIC = "AUTOMATIC",
	PLAYER_CHOICE = "PLAYER_CHOICE",
	OPPONENT_CHOICE = "OPPONENT_CHOICE",
	RANDOM = "RANDOM",
}

const Trigger := {
	ON_PLAY = "ON_PLAY",
	ON_SPELL_PLAYED = "ON_PLAY",
	CONTINUOUS = "CONTINUOUS",
	PASSIVE_MODIFIER = "CONTINUOUS",
}

## ========== PROPERTIES ==========
@export var ability_name: String = ""
@export var description: String = ""

## WHEN — the trigger that activates this ability
@export var trigger: Resource = null  # AbilityTrigger

## WHO — primary target blocks for the ability
@export var targets: Array = []  # Array[AbilityTarget]

## WHAT — the effect chain to execute
@export var effects: Array = []  # Array[EffectStep]

## ========== LEGACY PROPERTY ACCESSOR ==========
## Maps old GameManager property names to new Trigger/Target/Effect architecture.

func _get(property: StringName):
	var key := String(property)
	match key:
		"steps":
			return effects
		"school_tag":
			if trigger and trigger.get("trigger_interactors"):
				var pc: String = String(trigger.trigger_interactors.get("PlayedCard", ""))
				for part in pc.split(","):
					var p := part.strip_edges()
					if p.begins_with("tag:"):
						return p.substr(4)
			return ""
		"targeting_mode":
			if targets.size() > 0 and targets[0] != null:
				var t = targets[0].targeting if targets[0].get("targeting") else "Automatic"
				match t:
					"PlayerChoice": return "PLAYER_CHOICE"
					"OpponentChoice": return "OPPONENT_CHOICE"
					"Random": return "RANDOM"
					_: return "AUTOMATIC"
			return "AUTOMATIC"
		"valid_target_1":
			if targets.size() > 0 and targets[0] != null:
				var tt = targets[0].target_type if targets[0].get("target_type") else ""
				match tt:
					"Unit": return "UNIT"
					"Entity": return "ENTITY"
					"Player": return "PLAYER"
					"Area": return "AREA"
					"Deck", "Hand", "Graveyard", "Pile", "Card": return "NONE"
					_: return "NONE"
			return "NONE"
		"valid_target_2":
			if targets.size() > 0 and targets[0] != null:
				var own = targets[0].owner if targets[0].get("owner") else "Any"
				match own:
					"Ally": return "ALLY"
					"Enemy": return "ENEMY"
					_: return "ANY"
			return "ANY"
		"valid_target_3":
			if targets.size() > 0 and targets[0] != null:
				return targets[0].condition if targets[0].get("condition") else ""
			return ""
		"effect_range":
			if targets.size() > 0 and targets[0] != null:
				return targets[0].target_range if targets[0].get("target_range") else 0
			return 0
		"trigger_conditions":
			return []
	return null

## ========== METHODS ==========

func get_trigger_name(for_spell: bool = false) -> String:
	if trigger == null:
		return ""
	if trigger.event == "CONTINUOUS":
		return ""
	if trigger.event == "ON_PLAY":
		return "" if for_spell else "Csatakiáltás"
	return trigger.get_display_name()

func get_effect_text() -> String:
	if not description.is_empty():
		return description
	if effects.is_empty():
		return ""
	var parts: Array = []
	for effect in effects:
		var text := _effect_to_text(effect)
		if not text.is_empty():
			parts.append(text)
	return ". ".join(parts)

func _effect_to_text(effect) -> String:
	if effect == null:
		return ""
	var S = EffectStepScript.Step
	var p: Dictionary = effect.parameters if effect.parameters else {}
	match effect.step:
		S.DRAW: return "Húzz %d lapot" % p.get("DrawAmount", 1)
		S.DISCARD: return "Dobj el %d lapot" % p.get("DiscardAmount", 1)
		S.DEAL_DAMAGE: return "Sebezz %d-t" % p.get("DamageAmount", 1)
		S.HEAL: return "Gyógyíts %d-t" % p.get("HealAmount", 1)
		S.KILL: return "Megölés"
		S.EXILE: return "Száműzés"
		S.MODIFY_STAT:
			var stat: String = p.get("ModifiedStat", "")
			var amt: int = p.get("ModifyAmount", 0)
			match stat:
				"ATK": return "+%d Támadás" % amt
				"HP": return "+%d Életerő" % amt
				"ATK_HP": return "+%d/+%d" % [amt, amt]
				_: return "+%d buff" % amt
		S.MODIFY_KEYWORD:
			var added = p.get("AddedKeywords", [])
			if added is Array and added.size() > 0:
				return "%s kulcsszó" % ", ".join(added)
			return "Kulcsszó módosítás"
		S.MODIFY_COUNTER:
			var amt: int = p.get("ModifyAmount", 0)
			return "%+d gyűrű" % amt if p.get("CounterType", "") == "Ring" else "%+d számláló" % amt
		S.MAKE_ATTACK: return "Támadás!"
		S.EXECUTE_ABILITY: return "Képesség használata!"
		S.SUMMON: return "Idézés"
		S.MOVE_TO_ZONE: return "Lap áthelyezés"
		S.MOVE: return "Mozgatás"
		S.SWAP: return "Csere"
		S.ATTACH: return "Csatolás"
		S.SEARCH: return "Keresés"
		S.REVEAL: return "Felfedés"
		S.AUTO_PLAY: return "Automatikus kijátszás"
		_:
			if effect.has_flow():
				if effect.get_flow_type() == "choose_one":
					return "Válassz egyet!"
			return ""