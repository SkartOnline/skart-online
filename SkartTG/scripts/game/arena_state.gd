## ArenaState — the 5x5 grid of Tiles for board logic.
## Part of the Game→Arena hierarchy.
class_name ArenaState
extends RefCounted

const TileScript = preload("res://scripts/game/tile.gd")

const ROWS: int = 5
const COLS: int = 5

## 2D array of Tile objects: grid[row][col].
var grid: Array = []

func _init() -> void:
	_init_grid()

func _init_grid() -> void:
	grid.clear()
	for r in range(ROWS):
		var row_arr: Array = []
		for c in range(COLS):
			row_arr.append(TileScript.new(r, c))
		grid.append(row_arr)

# ── Access ──

func tile(row: int, col: int):
	if row < 0 or row >= ROWS or col < 0 or col >= COLS:
		return null
	return grid[row][col]

func is_valid(row: int, col: int) -> bool:
	return row >= 0 and row < ROWS and col >= 0 and col < COLS

func is_empty(row: int, col: int) -> bool:
	var t = tile(row, col)
	return t != null and t.is_empty()

func unit_at(row: int, col: int):
	var t = tile(row, col)
	if t == null:
		return null
	return t.unit

# ── Queries ──

## All tiles containing units, optionally filtered by owner.
## owner = -1 means all owners.
func units(owner: int = -1) -> Array:
	var result: Array = []
	for r in range(ROWS):
		for c in range(COLS):
			var u = grid[r][c].unit
			if u != null and (owner == -1 or u.owner_id == owner):
				result.append(u)
	return result

## All empty tiles.
func empty_tiles() -> Array:
	var result: Array = []
	for r in range(ROWS):
		for c in range(COLS):
			if grid[r][c].is_empty():
				result.append(grid[r][c])
	return result

## All tiles within Manhattan distance of an origin tile.
func tiles_in_range(origin_row: int, origin_col: int, distance: int) -> Array:
	var result: Array = []
	for r in range(ROWS):
		for c in range(COLS):
			if absi(r - origin_row) + absi(c - origin_col) <= distance:
				result.append(grid[r][c])
	return result

## Adjacent tiles (8-directional) to a position.
func adjacent_tiles(row: int, col: int) -> Array:
	var result: Array = []
	for dr in [-1, 0, 1]:
		for dc in [-1, 0, 1]:
			if dr == 0 and dc == 0:
				continue
			var nr: int = row + dr
			var nc: int = col + dc
			if is_valid(nr, nc):
				result.append(grid[nr][nc])
	return result

## Adjacent units to a position, optionally filtered by owner.
func adjacent_units(row: int, col: int, owner: int = -1) -> Array:
	var result: Array = []
	for t in adjacent_tiles(row, col):
		if t.unit != null and (owner == -1 or t.unit.owner_id == owner):
			result.append(t.unit)
	return result

# ── Mutation ──

## Place a unit on a tile. Returns true if the tile was empty.
func place_unit(unit, row: int, col: int) -> bool:
	var t = tile(row, col)
	if t == null or t.is_occupied():
		return false
	t.place_unit(unit)
	return true

## Remove the unit from a tile. Returns the removed unit or null.
func remove_unit(row: int, col: int):
	var t = tile(row, col)
	if t == null:
		return null
	return t.remove_unit()

## Move a unit from one tile to another. Returns true on success.
func move_unit(from_row: int, from_col: int, to_row: int, to_col: int) -> bool:
	var from_tile = tile(from_row, from_col)
	var to_tile = tile(to_row, to_col)
	if from_tile == null or to_tile == null:
		return false
	if from_tile.is_empty() or to_tile.is_occupied():
		return false
	var unit = from_tile.remove_unit()
	to_tile.place_unit(unit)
	return true

# ── Serialization ──

## Export grid as 2D array of card_ids (null for empty tiles).
func serialize() -> Array:
	var result: Array = []
	for r in range(ROWS):
		var row_arr: Array = []
		for c in range(COLS):
			var u = grid[r][c].unit
			if u != null:
				row_arr.append({
					"card_id": int(u.card.card_id) if u.card else 0,
					"owner_id": u.owner_id,
					"current_hp": u.current_hp,
					"rings": u.rings,
					"has_attacked": u.has_attacked,
					"has_moved": u.has_moved,
					"moves_remaining": u.moves_remaining,
					"keywords": u.keywords.duplicate(),
				})
			else:
				row_arr.append(null)
		result.append(row_arr)
	return result

## Clear the entire grid.
func clear() -> void:
	for r in range(ROWS):
		for c in range(COLS):
			grid[r][c].unit = null
