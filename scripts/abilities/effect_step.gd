## EffectStep — one mechanical action in an ability's effect chain.
## Part of the Trigger/Target/Effect architecture.
## Replaces the old AbilityStep with a strict 20-type model.
class_name EffectStep
extends Resource

const AbilityTargetScript = preload("res://scripts/abilities/target.gd")

## ========== EFFECT STEP TYPES ==========
const Step := {
	DRAW = "Draw",
	SEARCH = "Search",
	REVEAL = "Reveal",
	DISCARD = "Discard",
	MOVE_TO_ZONE = "MoveToZone",
	KILL = "Kill",
	EXILE = "Exile",
	DEAL_DAMAGE = "DealDamage",
	HEAL = "Heal",
	MODIFY_STAT = "ModifyStat",
	MODIFY_KEYWORD = "ModifyKeyword",
	MODIFY_COUNTER = "ModifyCounter",
	SUMMON = "Summon",
	MOVE = "Move",
	SWAP = "Swap",
	MAKE_ATTACK = "MakeAttack",
	ATTACH = "Attach",
	EXECUTE_ABILITY = "ExecuteAbility",
	AUTO_PLAY = "AutoPlay",
}

## ========== FLOW TYPES ==========
const FlowType := {
	NONE = "none",
	CONDITIONAL = "conditional",
	REPEAT = "repeat",
	REPEAT_WHILE = "repeat_while",
	FOR_EACH = "for_each",
	CHOOSE_ONE = "choose_one",
}

## ========== EFFECT INTERACTORS ==========
## Lookup table: step type → array of interactor names outputted by this step.
const EFFECT_INTERACTORS := {
	"Draw": ["DrawnCard"],
	"Search": ["SearchedZone", "SearchResults"],
	"Reveal": ["RevealedCards"],
	"Discard": ["DiscardedCards"],
	"MoveToZone": ["OriginZone", "GoalZone"],
	"Kill": ["KilledUnit"],
	"Exile": ["ExiledUnit"],
	"DealDamage": ["DamagedEntity"],
	"Heal": ["HealedEntity"],
	"ModifyStat": ["ModifiedEntity"],
	"ModifyKeyword": ["ModifiedEntity"],
	"ModifyCounter": ["ModifiedEntity"],
	"Summon": ["SummonedEntity"],
	"Move": ["MovedUnit"],
	"Swap": ["SwappedEntity1", "SwappedEntity2"],
	"MakeAttack": ["AttackingUnit", "AttackedEntity"],
	"Attach": ["HostUnit", "AttachedCard"],
	"ExecuteAbility": ["AbilitySource"],
	"AutoPlay": ["AutoPlayedCard"],
}

## ========== REQUIRED PARAMETERS PER STEP ==========
## For validation and the card editor: which parameter keys each step type expects.
const STEP_PARAMETERS := {
	"Draw": ["DrawAmount", "DrawFilters"],
	"Search": ["ShownAmount", "SelectAmount", "SearchFilters", "Prompt"],
	"Reveal": ["CardOrder", "RevealAmount"],
	"Discard": ["DiscardAmount", "DiscardFilters"],
	"MoveToZone": ["GoalZone", "GoalZoneOrder"],
	"Kill": [],
	"Exile": [],
	"DealDamage": ["DamageAmount"],
	"Heal": ["HealAmount"],
	"ModifyStat": ["ModifiedStat", "ModifyAmount", "SetAmount", "ModifyDuration", "ModifyDurationTurns", "ApplyFilter"],
	"ModifyKeyword": ["AddedKeywords", "RemovedKeywords", "NewKeywordDurations", "NewKeywordDurationTurns"],
	"ModifyCounter": ["CounterType", "ModifyAmount", "SetAmount"],
	"Summon": ["SummonedEntity", "SummoningTile"],
	"Move": ["MoveDirection", "MoveAmount"],
	"Swap": [],
	"MakeAttack": ["AttackedEntity"],
	"Attach": [],
	"ExecuteAbility": ["AbilityType", "AbilitySource", "AbilityTarget"],
	"AutoPlay": ["Targeting"],
}

## ========== ZONE NAMES ==========
const Zone := {
	MY_HAND = "MyHand",
	ENEMY_HAND = "EnemyHand",
	MY_DECK = "MyDeck",
	ENEMY_DECK = "EnemyDeck",
	MY_DECK_TOP = "MyDeckTop",
	MY_DECK_BOTTOM = "MyDeckBottom",
	ENEMY_DECK_TOP = "EnemyDeckTop",
	MY_DISCARD = "MyDiscard",
	ENEMY_DISCARD = "EnemyDiscard",
	MY_PILE = "MyPile",
	ENEMY_PILE = "EnemyPile",
	MY_EXILE = "MyExile",
	BOARD = "Board",
}

## ========== DURATION (for ModifyStat / ModifyKeyword) ==========
const Duration := {
	PERMANENT = 0,
	END_OF_TURN = 1,
	START_OF_NEXT_TURN = 2,
	END_OF_COMBAT = 3,
	UNTIL_USED = 4,
	WHILE_ATTACHED = 5,
}

## ========== STAT NAMES ==========
const StatName := {
	ATK = "ATK",
	HP = "HP",
	ATK_HP = "ATK_HP",
	MOVE_SPEED = "MOVE_SPEED",
	ATTACK_RANGE = "ATTACK_RANGE",
}

## ========== PROPERTIES ==========

## The effect action to perform. Null/empty for pure flow-control nodes.
@export var step: String = Step.DRAW

## Strict parameters for this step type. Keys depend on step — see STEP_PARAMETERS.
@export var parameters: Dictionary = {}

## Tag to assign to this step's output interactors for later reference.
@export var tag: String = ""

## Reference to the target entity for this step.
## Can be: "targets[0]", a trigger interactor name ("PlayedCard"),
## or a tagged effect interactor from a previous step ("drawn_cards").
@export var target_ref: String = ""

## Mid-chain secondary targeting, for steps that need to select from intermediate results.
@export var inline_target: Resource = null  # AbilityTarget

## ========== FLOW CONTROL ==========

## Flow control configuration as a Dictionary:
## { "type": "conditional", "condition": "..." }
## { "type": "repeat", "count": N }
## { "type": "repeat_while", "condition": "..." }
## { "type": "for_each", "source": "tag_name" }
## { "type": "choose_one" }
@export var flow: Dictionary = {}

## Child effects for flow control (then-branch for conditional, loop body, etc.)
@export var sub_effects: Array = []  # Array[EffectStep]

## Else branch for conditional flow
@export var else_effects: Array = []  # Array[EffectStep]

## Choices for choose_one flow: Array of { "label": String, "effects": Array[EffectStep] }
@export var choices: Array = []

## ========== METHODS ==========

func get_interactor_names() -> Array:
	return EFFECT_INTERACTORS.get(step, [])

func get_parameter_names() -> Array:
	return STEP_PARAMETERS.get(step, [])

func has_flow() -> bool:
	return not flow.is_empty()

func get_flow_type() -> String:
	return flow.get("type", FlowType.NONE)

func get_display_name() -> String:
	match step:
		Step.DRAW: return "Húzás"
		Step.SEARCH: return "Keresés"
		Step.REVEAL: return "Felfedés"
		Step.DISCARD: return "Eldobás"
		Step.MOVE_TO_ZONE: return "Zónaváltás"
		Step.KILL: return "Megölés"
		Step.EXILE: return "Száműzés"
		Step.DEAL_DAMAGE: return "Sebzés"
		Step.HEAL: return "Gyógyítás"
		Step.MODIFY_STAT: return "Stat módosítás"
		Step.MODIFY_KEYWORD: return "Kulcsszó módosítás"
		Step.MODIFY_COUNTER: return "Számláló módosítás"
		Step.SUMMON: return "Megidézés"
		Step.MOVE: return "Mozgatás"
		Step.SWAP: return "Csere"
		Step.MAKE_ATTACK: return "Támadás"
		Step.ATTACH: return "Csatolás"
		Step.EXECUTE_ABILITY: return "Képesség végrehajtás"
		Step.AUTO_PLAY: return "Automatikus kijátszás"
		_: return step
