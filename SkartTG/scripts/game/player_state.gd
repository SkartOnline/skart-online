## PlayerState — per-player state container.
## Part of the Game→Player hierarchy.
class_name PlayerState
extends RefCounted

const ZoneScript = preload("res://scripts/game/zone.gd")

## Player identity.
var player_id: int = 0  ## 0 = local, 1 = opponent

## Life and resources.
var hp: int = 20
var mana: int = 0
var max_mana: int = 0
var rings: int = 0

## Zones — each is a Zone object.
var deck = null
var hand = null
var graveyard = null  ## Temető — dead units
var pile = null       ## Rakás — used spells
var exile = null      ## Umbrá — permanently removed

## Characters (2 per player).
var characters: Array = []  ## Array of CharacterCard resources

## Whether this player's zones are hidden (MP opponent).
var is_opponent: bool = false

func _init(id: int = 0, hidden: bool = false) -> void:
	player_id = id
	is_opponent = hidden
	deck = ZoneScript.create(ZoneScript.ZoneType.DECK, id, hidden)
	hand = ZoneScript.create(ZoneScript.ZoneType.HAND, id, hidden)
	graveyard = ZoneScript.create(ZoneScript.ZoneType.GRAVEYARD, id, hidden)
	pile = ZoneScript.create(ZoneScript.ZoneType.PILE, id, hidden)
	exile = ZoneScript.create(ZoneScript.ZoneType.EXILE, id, hidden)

## Get a zone by name string (for dynamic resolution).
func zone_by_name(zone_name: String):
	match zone_name:
		"Deck", "deck":
			return deck
		"Hand", "hand":
			return hand
		"Graveyard", "graveyard", "Discard", "discard":
			return graveyard
		"Pile", "pile":
			return pile
		"Exile", "exile":
			return exile
	return null

## All zones as an array (for searching across zones).
func all_zones() -> Array:
	return [deck, hand, graveyard, pile, exile]

## Find which zone contains a card. Returns the Zone or null.
func find_zone_containing(card):
	for z in all_zones():
		if z.has(card):
			return z
	return null

## Remove a card from wherever it is. Returns the zone it was in, or null.
func remove_card_from_any_zone(card):
	for z in all_zones():
		if z.remove(card):
			return z
	return null

# ── Serialization ──

func serialize() -> Dictionary:
	return {
		"player_id": player_id,
		"hp": hp,
		"mana": mana,
		"max_mana": max_mana,
		"rings": rings,
		"deck": deck.serialize(),
		"hand": hand.serialize(),
		"graveyard": graveyard.serialize(),
		"pile": pile.serialize(),
		"exile": exile.serialize(),
		"characters": characters.map(func(c): return int(c.card_id) if c and c.get("card_id") else 0),
	}

func load_from_data(data: Dictionary) -> void:
	hp = int(data.get("hp", 20))
	mana = int(data.get("mana", 0))
	max_mana = int(data.get("max_mana", 0))
	rings = int(data.get("rings", 0))
	if data.has("deck"):
		deck.load_from_ids(data["deck"].get("card_ids", []))
	if data.has("hand"):
		hand.load_from_ids(data["hand"].get("card_ids", []))
	if data.has("graveyard"):
		graveyard.load_from_ids(data["graveyard"].get("card_ids", []))
	if data.has("pile"):
		pile.load_from_ids(data["pile"].get("card_ids", []))
	if data.has("exile"):
		exile.load_from_ids(data["exile"].get("card_ids", []))
