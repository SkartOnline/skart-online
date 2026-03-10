## Zone — represents a card zone (deck, hand, graveyard, pile, exile).
## Part of the Game→Player→Zone hierarchy.
class_name Zone
extends RefCounted

const CardDatabaseScript = preload("res://scripts/cards/card_database.gd")

enum ZoneType { DECK, HAND, GRAVEYARD, PILE, EXILE }

## Which zone this is.
var zone_type: ZoneType = ZoneType.DECK

## Which player owns this zone (0 = local, 1 = opponent).
var owner_id: int = 0

## Full card objects — available when we have complete info (ally zones, or MP revealed).
var cards: Array = []

## Card IDs only — used for hidden enemy zones in multiplayer.
## When non-empty, this is the authoritative source and cards may be empty.
var card_ids: Array[int] = []

## Whether this zone stores only IDs (hidden enemy zone in MP).
var is_hidden: bool = false

# ── Construction ──

static func create(type: ZoneType, owner: int, hidden: bool = false) -> Zone:
	var z := Zone.new()
	z.zone_type = type
	z.owner_id = owner
	z.is_hidden = hidden
	return z

# ── Size ──

func size() -> int:
	if is_hidden:
		return card_ids.size()
	return cards.size()

func is_empty() -> bool:
	return size() == 0

# ── Access ──

## Top card (last element = top of deck convention).
func top():
	if is_hidden:
		if card_ids.is_empty():
			return null
		return CardDatabaseScript.get_card(card_ids.back())
	if cards.is_empty():
		return null
	return cards.back()

## Bottom card (first element).
func bottom():
	if is_hidden:
		if card_ids.is_empty():
			return null
		return CardDatabaseScript.get_card(card_ids[0])
	if cards.is_empty():
		return null
	return cards[0]

## Get card at index.
func at(index: int):
	if is_hidden:
		if index < 0 or index >= card_ids.size():
			return null
		return CardDatabaseScript.get_card(card_ids[index])
	if index < 0 or index >= cards.size():
		return null
	return cards[index]

## Resolve all cards (materializes hidden IDs into card objects).
func resolve_cards() -> Array:
	if not is_hidden:
		return cards
	var result: Array = []
	for cid in card_ids:
		var card = CardDatabaseScript.get_card(cid)
		if card:
			result.append(card)
	return result

# ── Mutation ──

## Add a card to the end (top of deck / right side of hand).
func add(card, position: int = -1) -> void:
	if is_hidden:
		var cid: int = int(card.card_id) if card.get("card_id") else 0
		if cid > 0:
			if position < 0:
				card_ids.append(cid)
			else:
				card_ids.insert(position, cid)
		return
	if position < 0:
		cards.append(card)
	else:
		cards.insert(position, card)

## Add a card to the bottom (position 0).
func add_bottom(card) -> void:
	add(card, 0)

## Remove a specific card. Returns true if found.
func remove(card) -> bool:
	if is_hidden:
		var cid: int = int(card.card_id) if card.get("card_id") else 0
		var hidden_idx: int = card_ids.find(cid)
		if hidden_idx >= 0:
			card_ids.remove_at(hidden_idx)
			return true
		return false
	var idx: int = cards.find(card)
	if idx >= 0:
		cards.remove_at(idx)
		return true
	return false

## Remove and return the top card.
func pop_top():
	if is_hidden:
		if card_ids.is_empty():
			return null
		var cid: int = card_ids.pop_back()
		return CardDatabaseScript.get_card(cid)
	if cards.is_empty():
		return null
	return cards.pop_back()

## Remove and return the bottom card.
func pop_bottom():
	if is_hidden:
		if card_ids.is_empty():
			return null
		var cid: int = card_ids.pop_front()
		return CardDatabaseScript.get_card(cid)
	if cards.is_empty():
		return null
	return cards.pop_front()

## Remove at index and return.
func remove_at(index: int):
	if is_hidden:
		if index < 0 or index >= card_ids.size():
			return null
		var cid: int = card_ids[index]
		card_ids.remove_at(index)
		return CardDatabaseScript.get_card(cid)
	if index < 0 or index >= cards.size():
		return null
	var card = cards[index]
	cards.remove_at(index)
	return card

## Find index of a card (-1 if not found).
func find(card) -> int:
	if is_hidden:
		var cid: int = int(card.card_id) if card.get("card_id") else 0
		return card_ids.find(cid)
	return cards.find(card)

## Check if zone contains a specific card.
func has(card) -> bool:
	return find(card) >= 0

## Shuffle the zone (for decks).
func shuffle() -> void:
	if is_hidden:
		card_ids.shuffle()
	else:
		cards.shuffle()

## Clear all cards.
func clear() -> void:
	cards.clear()
	card_ids.clear()

# ── Filtering ──

## Return all cards matching a filter callable: func(card) -> bool.
func filter(predicate: Callable) -> Array:
	var source: Array = resolve_cards()
	var result: Array = []
	for card in source:
		if card != null and predicate.call(card):
			result.append(card)
	return result

# ── Serialization ──

func serialize() -> Dictionary:
	if is_hidden:
		return { "card_ids": card_ids.duplicate() }
	var ids: Array[int] = []
	for card in cards:
		if card and card.get("card_id"):
			ids.append(int(card.card_id))
	return { "card_ids": ids }

func load_from_ids(ids: Array) -> void:
	card_ids.clear()
	cards.clear()
	for cid in ids:
		if is_hidden:
			card_ids.append(int(cid))
		else:
			var card = CardDatabaseScript.get_card(int(cid))
			if card:
				cards.append(card)
