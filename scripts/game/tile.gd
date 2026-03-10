## Tile — logic-side representation of one grid cell.
## Part of the Game→Arena→Tile hierarchy.
class_name Tile
extends RefCounted

## Grid position.
var row: int = 0
var col: int = 0

## The unit occupying this tile, or null if empty.
var unit = null  ## UnitInstance or null

func _init(r: int = 0, c: int = 0) -> void:
	row = r
	col = c

func is_empty() -> bool:
	return unit == null

func is_occupied() -> bool:
	return unit != null

## Manhattan distance to another tile.
func distance_to(other: Tile) -> int:
	return absi(row - other.row) + absi(col - other.col)

## Chebyshev distance (8-directional adjacency).
func chebyshev_distance_to(other: Tile) -> int:
	return maxi(absi(row - other.row), absi(col - other.col))

## Whether this tile is adjacent (8-directional, distance 1).
func is_adjacent_to(other: Tile) -> bool:
	return chebyshev_distance_to(other) == 1

## Place a unit on this tile. Updates the unit's grid position.
func place_unit(u) -> void:
	unit = u
	if u != null:
		u.grid_row = row
		u.grid_col = col

## Remove and return the unit from this tile.
func remove_unit():
	var u = unit
	unit = null
	return u

## Coordinate label (A1, B3, etc.) for display.
func label() -> String:
	return "%s%d" % [char(65 + col), row + 1]
