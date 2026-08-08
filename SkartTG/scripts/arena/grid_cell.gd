## Grid cell — individual cell in the 5x5 arena.
## Shows cards as square tiles: cost+name top, art middle, atk/def bottom corners.
class_name GridCell
extends Panel

signal cell_clicked(row: int, col: int)
signal cell_right_clicked(row: int, col: int)
signal cell_hovered(row: int, col: int)

@export var row: int = 0
@export var col: int = 0
var occupying_card: Resource = null
var is_highlighted: bool = false
var _target_highlighted: bool = false

## Visual nodes (created in _setup_card_display)
var _name_bar: PanelContainer = null
var _name_row: HBoxContainer = null
var _cost_icon: TextureRect = null
var _name_cost_label: Label = null
var _art_rect: ColorRect = null
var _stats_bar: PanelContainer = null
var _atk_icon: TextureRect = null
var _atk_label: Label = null
var _mid_label: Label = null
var _def_icon: TextureRect = null
var _def_label: Label = null
var _coord_label: Label = null

## Styles
var normal_style: StyleBoxFlat
var hover_style: StyleBoxFlat
var occupied_style: StyleBoxFlat
var occupied_enemy_style: StyleBoxFlat
var target_style: StyleBoxFlat

const CLASS_PALETTES := {
	"Harcos": {"dark": Color(0.35, 0.03, 0.03), "mid": Color(0.55, 0.04, 0.04)},
	"Mágus": {"dark": Color(0.08, 0.2, 0.45), "mid": Color(0.12, 0.44, 0.72)},
	"Vaják": {"dark": Color(0.1, 0.25, 0.07), "mid": Color(0.22, 0.46, 0.11)},
	"Zsivány": {"dark": Color(0.18, 0.18, 0.18), "mid": Color(0.34, 0.34, 0.34)},
	"Bölcs": {"dark": Color(0.35, 0.18, 0.28), "mid": Color(0.65, 0.37, 0.49)},
	"Garabonciás": {"dark": Color(0.15, 0.08, 0.3), "mid": Color(0.3, 0.17, 0.52)},
	"Csodatevő": {"dark": Color(0.4, 0.22, 0.05), "mid": Color(0.85, 0.5, 0.1)},
}
const DEFAULT_PAL := {"dark": Color(0.15, 0.15, 0.18), "mid": Color(0.35, 0.35, 0.4)}
const ICON_ATK := preload("res://data/art/ui_assets_icons/atk.png")
const ICON_HP := preload("res://data/art/ui_assets_icons/hp.png")
const ICON_MANA := preload("res://data/art/ui_assets_icons/mana.png")

func _ready() -> void:
	_setup_styles()
	_setup_card_display()
	add_theme_stylebox_override("panel", normal_style)
	mouse_entered.connect(_on_mouse_entered)
	mouse_exited.connect(_on_mouse_exited)
	gui_input.connect(_on_gui_input)

func _setup_styles() -> void:
	normal_style = StyleBoxFlat.new()
	normal_style.bg_color = Color(0.086, 0.106, 0.133, 0.8)
	normal_style.border_color = Color(0.282, 0.31, 0.345)
	normal_style.set_border_width_all(1)
	normal_style.set_corner_radius_all(3)

	hover_style = StyleBoxFlat.new()
	hover_style.bg_color = Color(0.345, 0.651, 1.0, 0.15)
	hover_style.border_color = Color(0.345, 0.651, 1.0)
	hover_style.set_border_width_all(2)
	hover_style.set_corner_radius_all(3)

	occupied_style = StyleBoxFlat.new()
	occupied_style.bg_color = Color(0.086, 0.106, 0.133, 0.9)
	occupied_style.border_color = Color(0.345, 0.651, 1.0)
	occupied_style.set_border_width_all(2)
	occupied_style.set_corner_radius_all(3)

	occupied_enemy_style = StyleBoxFlat.new()
	occupied_enemy_style.bg_color = Color(0.133, 0.086, 0.086, 0.9)
	occupied_enemy_style.border_color = Color(0.85, 0.3, 0.3)
	occupied_enemy_style.set_border_width_all(2)
	occupied_enemy_style.set_corner_radius_all(3)

	target_style = StyleBoxFlat.new()
	target_style.bg_color = Color(1.0, 0.65, 0.0, 0.15)
	target_style.border_color = Color(1.0, 0.65, 0.0)
	target_style.set_border_width_all(2)
	target_style.set_corner_radius_all(3)

func _setup_card_display() -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_preset(PRESET_FULL_RECT)
	margin.mouse_filter = MOUSE_FILTER_IGNORE
	margin.add_theme_constant_override("margin_left", 2)
	margin.add_theme_constant_override("margin_right", 2)
	margin.add_theme_constant_override("margin_top", 1)
	margin.add_theme_constant_override("margin_bottom", 1)
	add_child(margin)

	_coord_label = Label.new()
	_coord_label.mouse_filter = MOUSE_FILTER_IGNORE
	_coord_label.text = get_grid_label()
	_coord_label.position = Vector2(4, 2)
	_coord_label.add_theme_font_size_override("font_size", 9)
	_coord_label.add_theme_color_override("font_color", Color(0.45, 0.5, 0.58))
	_coord_label.z_index = -10
	add_child(_coord_label)

	var vbox := VBoxContainer.new()
	vbox.mouse_filter = MOUSE_FILTER_IGNORE
	vbox.add_theme_constant_override("separation", 0)
	margin.add_child(vbox)

	# Top: name bar with colored background
	_name_bar = PanelContainer.new()
	_name_bar.mouse_filter = MOUSE_FILTER_IGNORE
	var nb_style := StyleBoxFlat.new()
	nb_style.bg_color = Color(0, 0, 0, 0)
	nb_style.set_content_margin_all(0)
	_name_bar.add_theme_stylebox_override("panel", nb_style)
	vbox.add_child(_name_bar)

	_name_row = HBoxContainer.new()
	_name_row.mouse_filter = MOUSE_FILTER_IGNORE
	_name_row.add_theme_constant_override("separation", 2)
	_name_bar.add_child(_name_row)

	_cost_icon = TextureRect.new()
	_cost_icon.mouse_filter = MOUSE_FILTER_IGNORE
	_cost_icon.texture = ICON_MANA
	_cost_icon.custom_minimum_size = Vector2(9, 9)
	_cost_icon.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	_cost_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_cost_icon.visible = false
	_name_row.add_child(_cost_icon)

	_name_cost_label = Label.new()
	_name_cost_label.mouse_filter = MOUSE_FILTER_IGNORE
	_name_cost_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	_name_cost_label.add_theme_font_size_override("font_size", 11)
	_name_cost_label.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
	_name_cost_label.clip_text = true
	_name_cost_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_cost_label.custom_minimum_size = Vector2(0, 14)
	_name_row.add_child(_name_cost_label)

	# Art area (expands to fill)
	_art_rect = ColorRect.new()
	_art_rect.mouse_filter = MOUSE_FILTER_IGNORE
	_art_rect.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_art_rect.color = Color(0.07, 0.09, 0.12, 0.0)
	vbox.add_child(_art_rect)

	# Bottom row: ATK left, DEF right with colored background
	_stats_bar = PanelContainer.new()
	_stats_bar.mouse_filter = MOUSE_FILTER_IGNORE
	var sb_style := StyleBoxFlat.new()
	sb_style.bg_color = Color(0, 0, 0, 0)
	sb_style.set_content_margin_all(0)
	_stats_bar.add_theme_stylebox_override("panel", sb_style)
	vbox.add_child(_stats_bar)

	var bottom := HBoxContainer.new()
	bottom.mouse_filter = MOUSE_FILTER_IGNORE
	bottom.add_theme_constant_override("separation", 2)
	bottom.custom_minimum_size = Vector2(0, 12)
	_stats_bar.add_child(bottom)

	_atk_icon = TextureRect.new()
	_atk_icon.mouse_filter = MOUSE_FILTER_IGNORE
	_atk_icon.texture = ICON_ATK
	_atk_icon.custom_minimum_size = Vector2(10, 10)
	_atk_icon.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	_atk_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_atk_icon.visible = false
	bottom.add_child(_atk_icon)

	_atk_label = Label.new()
	_atk_label.mouse_filter = MOUSE_FILTER_IGNORE
	_atk_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	_atk_label.add_theme_font_size_override("font_size", 12)
	_atk_label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.4))
	_atk_label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	bottom.add_child(_atk_label)

	_mid_label = Label.new()
	_mid_label.mouse_filter = MOUSE_FILTER_IGNORE
	_mid_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_mid_label.add_theme_font_size_override("font_size", 9)
	_mid_label.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
	_mid_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bottom.add_child(_mid_label)

	_def_icon = TextureRect.new()
	_def_icon.mouse_filter = MOUSE_FILTER_IGNORE
	_def_icon.texture = ICON_HP
	_def_icon.custom_minimum_size = Vector2(10, 10)
	_def_icon.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	_def_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_def_icon.visible = false
	bottom.add_child(_def_icon)

	_def_label = Label.new()
	_def_label.mouse_filter = MOUSE_FILTER_IGNORE
	_def_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_def_label.add_theme_font_size_override("font_size", 12)
	_def_label.add_theme_color_override("font_color", Color(1.0, 0.4, 0.4))
	_def_label.size_flags_horizontal = Control.SIZE_SHRINK_END
	bottom.add_child(_def_label)

func _on_mouse_entered() -> void:
	if _target_highlighted:
		add_theme_stylebox_override("panel", target_style)
	elif not occupying_card:
		add_theme_stylebox_override("panel", hover_style)
	cell_hovered.emit(row, col)

func _on_mouse_exited() -> void:
	_apply_default_style()

func _on_gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			cell_clicked.emit(row, col)
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			cell_right_clicked.emit(row, col)

func place_card(card: Resource) -> void:
	occupying_card = card
	_apply_default_style()

func set_unit_display(unit) -> void:
	if not unit:
		_clear_display()
		return
	var card = unit.card
	var card_class: String = card.card_class if card.get("card_class") else ""
	var pal: Dictionary = CLASS_PALETTES.get(card_class, DEFAULT_PAL)

	_name_cost_label.text = "%d %s" % [card.cost, card.card_name]
	if _cost_icon:
		_cost_icon.visible = true
	_art_rect.color = pal["dark"]
	if _atk_icon:
		_atk_icon.visible = true
	if _def_icon:
		_def_icon.visible = true
	_atk_label.text = str(unit.get_effective_attack())
	_def_label.text = str(unit.get_effective_hp())
	_mid_label.text = _build_status_bar(unit)
	var show_mid: bool = _mid_label.text != ""
	_mid_label.visible = show_mid
	if show_mid:
		_mid_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_atk_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_def_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	else:
		_mid_label.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		_atk_label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		_def_label.size_flags_horizontal = Control.SIZE_SHRINK_END

	# Color bars based on owner: green for ally, red for enemy
	var ally_bar := Color(0.1, 0.38, 0.1, 0.9)
	var enemy_bar := Color(0.48, 0.08, 0.08, 0.9)
	var bar_color := enemy_bar if unit.owner_id == 1 else ally_bar

	var nbs := StyleBoxFlat.new()
	nbs.bg_color = bar_color
	nbs.set_content_margin_all(0)
	nbs.set_corner_radius_all(2)
	_name_bar.add_theme_stylebox_override("panel", nbs)

	var sbs := StyleBoxFlat.new()
	sbs.bg_color = bar_color
	sbs.set_content_margin_all(0)
	sbs.set_corner_radius_all(2)
	_stats_bar.add_theme_stylebox_override("panel", sbs)

	_name_cost_label.add_theme_color_override("font_color", Color(0.95, 0.95, 0.95))
	_atk_label.add_theme_color_override("font_color", Color(1.0, 0.95, 0.8))
	_def_label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.85))

	if _target_highlighted:
		add_theme_stylebox_override("panel", target_style)
	elif unit.owner_id == 1:
		add_theme_stylebox_override("panel", occupied_enemy_style)
	else:
		add_theme_stylebox_override("panel", occupied_style)

func _clear_display() -> void:
	_name_cost_label.text = ""
	if _cost_icon:
		_cost_icon.visible = false
	_art_rect.color = Color(0.07, 0.09, 0.12, 0.0)
	if _atk_icon:
		_atk_icon.visible = false
	if _def_icon:
		_def_icon.visible = false
	_atk_label.text = ""
	_def_label.text = ""
	_mid_label.text = ""
	_mid_label.visible = false
	var clear_style := StyleBoxFlat.new()
	clear_style.bg_color = Color(0, 0, 0, 0)
	clear_style.set_content_margin_all(0)
	_name_bar.add_theme_stylebox_override("panel", clear_style)
	_stats_bar.add_theme_stylebox_override("panel", clear_style.duplicate())

func _build_status_bar(unit) -> String:
	var parts: Array[String] = []
	for kw in unit.keywords:
		parts.append(_status_short(str(kw)))
	if not unit.card or not unit.card.get("abilities"):
		return " ".join(parts) if not parts.is_empty() else ""
	for ab in unit.card.abilities:
		if not ab:
			continue
		var trig_event: String = ""
		if ab.trigger is String:
			trig_event = String(ab.trigger)
		elif ab.trigger and ab.trigger.get("event") != null:
			trig_event = String(ab.trigger.event)
		if trig_event == "ON_DEATH":
			parts.append("☠")
		elif trig_event == "ON_TURN_END":
			parts.append("⏳")
	if parts.is_empty():
		return ""
	return " ".join(parts)

func _status_short(text: String) -> String:
	var lower := text.to_lower()
	if lower.contains("shield") or lower.contains("pajzs"):
		return "🛡"
	if lower.contains("stun") or lower.contains("káb"):
		return "💫"
	if lower.contains("death") or lower.contains("hal"):
		return "☠"
	return text.left(2)

func remove_card() -> Resource:
	var card := occupying_card
	occupying_card = null
	_clear_display()
	_apply_default_style()
	return card

func is_empty() -> bool:
	return occupying_card == null

func get_grid_label() -> String:
	return "%s%d" % ["ABCDE"[col], row + 1]

func set_coordinate_text(text: String) -> void:
	if _coord_label:
		_coord_label.text = text

func set_target_highlight(enabled: bool) -> void:
	_target_highlighted = enabled
	_apply_default_style()

func _apply_default_style() -> void:
	if _target_highlighted:
		add_theme_stylebox_override("panel", target_style)
	elif occupying_card:
		add_theme_stylebox_override("panel", occupied_style)
	else:
		add_theme_stylebox_override("panel", normal_style)
