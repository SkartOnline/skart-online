## AbilityTarget — defines WHO an ability affects.
## Part of the Trigger/Target/Effect architecture.
## Used both as primary target blocks on Ability and as inline_target on EffectStep.
class_name AbilityTarget
extends Resource

## ========== TARGET TYPES ==========
const TargetType := {
	UNIT = "Unit",
	PLAYER = "Player",
	ENTITY = "Entity",
	DECK = "Deck",
	HAND = "Hand",
	GRAVEYARD = "Graveyard",
	PILE = "Pile",
	AREA = "Area",
	CARD = "Card",
}

## ========== TARGET OWNER ==========
const Owner := {
	ALLY = "Ally",
	ENEMY = "Enemy",
	ANY = "Any",
}

## ========== TARGETING MODE ==========
const Targeting := {
	AUTOMATIC = "Automatic",
	PLAYER_CHOICE = "PlayerChoice",
	OPPONENT_CHOICE = "OpponentChoice",
	RANDOM = "Random",
	ALL_VALID = "AllValid",
	SELF = "Self",
}

## ========== PROPERTIES ==========

@export var target_type: String = TargetType.UNIT

@export var owner: String = Owner.ANY

## Filter expression for targets. Comma-separated conditions.
## e.g. "cost < 5", "tag:Kalóz", "atk < 2", "cost < PlayedCard.cost"
@export var condition: String = ""

## Manhattan distance range. -1 = unlimited, 0 = N/A (no range needed).
@export var target_range: int = 0

## Number of targets to select. 0 = N/A (used for non-countable targets like Deck).
@export var count: int = 1

@export var targeting: String = Targeting.AUTOMATIC

## Prompt text for PlayerChoice targeting (shown to the player).
@export var prompt: String = ""

## If set, resolves to the named trigger interactor automatically.
## Always implies target_type = Card, targeting = Automatic.
## e.g. "PlayedCard", "KilledUnit", "AttackingUnit"
@export var trigger_interactor: String = ""
