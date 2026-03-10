## Arena — main game scene controller.
## Left: arena grid. Right: enemy hand, display, player hand, side panel.
## Unified flow: SAME code for test mode and multiplayer.
## game_manager.gd IS the game engine. Arena is just I/O.
extends Control

const GRID_ROWS := 5
const GRID_COLS := 5

const CardDatabaseScript = preload("res://scripts/cards/card_database.gd")
const GameManagerScript = preload("res://scripts/game/game_manager.gd")
const CardScript = preload("res://scripts/cards/card.gd")
const AbilityScript = preload("res://scripts/abilities/ability.gd")
const ICON_ATK_PATH := "res://data/art/ui_assets_icons/atk.png"
const ICON_HP_PATH := "res://data/art/ui_assets_icons/hp.png"
const ICON_RANGE_PATH := "res://data/art/ui_assets_icons/range.png"
const ICON_MANA_PATH := "res://data/art/ui_assets_icons/mana.png"
const ICON_DECK_PATH := "res://data/art/ui_assets_icons/deck.png"
const ICON_GRAVEYARD_PATH := "res://data/art/ui_assets_icons/graveyard.png"
const ICON_RAKAS_PATH := "res://data/art/ui_assets_icons/rakas.png"

## Grid
@onready var grid_container: GridContainer = %GridContainer
@onready var center_panel: CenterContainer = $MainLayout/ArenaColumn

## Hand areas (horizontal)
@onready var player_hand: HBoxContainer = %PlayerHand
@onready var enemy_hand: HBoxContainer = %EnemyHand
@onready var enemy_hand_switch: Button = %EnemyHandSwitch
@onready var player_hand_switch: Button = %PlayerHandSwitch

## Info bars
@onready var opponent_hp_label: Label = %OpponentHPLabel
@onready var opponent_mana_label: Label = %OpponentManaLabel
@onready var player_hp_label: Label = %PlayerHPCount
@onready var player_mana_label: Label = %PlayerManaCount
@onready var player_deck_count: Label = %PlayerDeckCount
@onready var player_discard_count: Label = %PlayerDiscardCount
@onready var player_pile_count: Label = %PlayerPileCount
@onready var enemy_deck_count: Label = %EnemyDeckCount
@onready var enemy_discard_count: Label = %EnemyDiscardCount
@onready var enemy_pile_count: Label = %EnemyPileCount
@onready var opponent_chars: HBoxContainer = %OpponentChars
@onready var player_chars: HBoxContainer = %PlayerChars

## Card preview
@onready var card_preview: PanelContainer = %CardPreview
@onready var preview_title: Label = %PreviewTitle
@onready var preview_art: ColorRect = %PreviewArt
@onready var preview_type: Label = %PreviewType
@onready var preview_sep: HSeparator = get_node_or_null("MainLayout/RightSection/ContentMiddle/CardPreview/PreviewContent/PreviewSep")
@onready var preview_ability: RichTextLabel = %PreviewAbility
@onready var preview_stats: Label = %PreviewStats
@onready var preview_stats_row: HBoxContainer = $MainLayout/RightSection/ContentMiddle/CardPreview/PreviewContent/PreviewStatsRow
@onready var preview_atk_label: Label = $MainLayout/RightSection/ContentMiddle/CardPreview/PreviewContent/PreviewStatsRow/PreviewAtkLabel
@onready var preview_def_label: Label = $MainLayout/RightSection/ContentMiddle/CardPreview/PreviewContent/PreviewStatsRow/PreviewDefLabel

## Turn controls
@onready var turn_label: Label = %TurnLabel
@onready var end_turn_button: Button = %EndTurnButton
@onready var opponent_name_label: Label = %OpponentNameLabel
@onready var player_name_label: Label = %PlayerNameLabel
@onready var command_hint_panel: PanelContainer = %CommandHintPanel
@onready var command_hint_label: Label = %CommandHintLabel
@onready var game_log_view: RichTextLabel = %GameLogView
@onready var game_log_panel: PanelContainer = %GameLogPanel

var grid_cells: Array = []
var game_manager = null
var selected_hand_index: int = -1
var hovered_hand_index: int = -1
var _hand_items: Array = []
var _choice_panel: Control = null
var _steal_panel: Control = null
var _command_target_popup: Control = null
var _cell_size: int = 80
var _preview_atk_icon: TextureRect = null
var _preview_mid_icon: TextureRect = null
var _preview_def_icon: TextureRect = null
var _preview_cost_icon: TextureRect = null
var _preview_cost_label: Label = null
var _preview_art_texture: TextureRect = null
var _icon_atk: Texture2D = null
var _icon_hp: Texture2D = null
var _icon_range: Texture2D = null
var _icon_mana: Texture2D = null
var _icon_deck: Texture2D = null
var _icon_graveyard: Texture2D = null
var _icon_rakas: Texture2D = null

## Unit action state: 0=idle, 1=moving, 2=attacking
var _unit_action_state: int = 0
var _selected_unit_row: int = -1
var _selected_unit_col: int = -1
var _action_popup: Control = null
var _player_showing_bench: bool = false
var _enemy_showing_bench: bool = false

var log_lines: Array[String] = []
var arena_state: Dictionary = {}

## Perspective: maps data coords to display order
var _perspective_flip_rows: bool = false  ## P1: true (own base at bottom)
var _perspective_flip_cols: bool = false  ## P2: true (E5 on left)

## Multiplayer transport (arena = I/O layer, game_manager = brain)
var _mp_mode: bool = false
var dev_mode: bool = false
var _dev_menu = null  ## DevContextMenu instance (created when dev_mode)
var _mp_lobby_id: String = ""
var _mp_token: String = ""
var _mp_user_id: int = 0
var _mp_base_url: String = ""
var _mp_poll_timer: Timer = null
var _mp_http_poll: HTTPRequest = null
var _mp_http_sync: HTTPRequest = null

## Noise texture for card preview background
var _noise_tex: NoiseTexture2D = null
var _known_cards_by_name: Dictionary = {}

func _ready() -> void:
	_load_icon_textures()
	_setup_noise()
	_setup_grid()
	_setup_preview_icons()
	_setup_preview_art_texture()
	_setup_info_bar_icons()
	_clear_preview()
	_setup_character_slots()
	_update_counts()
	turn_label.text = "Multiplayer"
	opponent_name_label.text = "Ellenfél"
	player_name_label.text = "Te"
	if command_hint_panel:
		command_hint_panel.visible = false
	if game_log_view:
		game_log_view.clear()
		game_log_view.meta_clicked.connect(_on_log_meta_clicked)
		game_log_view.meta_hover_started.connect(_on_log_meta_hover_started)
	end_turn_button.pressed.connect(_end_turn)
	enemy_hand_switch.pressed.connect(_toggle_enemy_hand_bench)
	player_hand_switch.pressed.connect(_toggle_player_hand_bench)
	center_panel.resized.connect(_resize_grid)

	# Style end turn button
	var btn_s := StyleBoxFlat.new()
	btn_s.bg_color = Color(0.15, 0.18, 0.25)
	btn_s.border_color = Color(0.831, 0.659, 0.263)
	btn_s.set_border_width_all(2)
	btn_s.set_corner_radius_all(4)
	btn_s.set_content_margin_all(6)
	end_turn_button.add_theme_stylebox_override("normal", btn_s)
	var btn_h := btn_s.duplicate()
	btn_h.bg_color = Color(0.22, 0.25, 0.33)
	end_turn_button.add_theme_stylebox_override("hover", btn_h)
	end_turn_button.add_theme_color_override("font_color", Color(0.831, 0.659, 0.263))
	end_turn_button.add_theme_font_size_override("font_size", 13)
	if command_hint_panel:
		var chs := StyleBoxFlat.new()
		chs.bg_color = Color(0.12, 0.14, 0.19)
		chs.border_color = Color(0.831, 0.659, 0.263)
		chs.set_border_width_all(1)
		chs.set_corner_radius_all(5)
		chs.set_content_margin_all(6)
		command_hint_panel.add_theme_stylebox_override("panel", chs)
	if command_hint_label:
		command_hint_label.add_theme_color_override("font_color", Color(0.92, 0.94, 0.97))
		command_hint_label.add_theme_font_size_override("font_size", 12)
	if game_log_view and game_log_view.get_parent() is PanelContainer:
		var log_panel := game_log_view.get_parent() as PanelContainer
		var lps := StyleBoxFlat.new()
		lps.bg_color = Color(0.08, 0.1, 0.14)
		lps.border_color = Color(0.2, 0.24, 0.3)
		lps.set_border_width_all(1)
		lps.set_corner_radius_all(5)
		lps.set_content_margin_all(4)
		log_panel.add_theme_stylebox_override("panel", lps)
		game_log_view.add_theme_color_override("default_color", Color(0.85, 0.88, 0.92))
		game_log_view.add_theme_font_size_override("normal_font_size", 11)

	# Style card preview
	var ps := StyleBoxFlat.new()
	ps.bg_color = Color(0.07, 0.09, 0.12)
	ps.border_color = Color(0.2, 0.22, 0.28)
	ps.set_border_width_all(1)
	ps.set_corner_radius_all(4)
	ps.set_content_margin_all(6)
	card_preview.add_theme_stylebox_override("panel", ps)

	# Style hand bars and side panel
	_setup_hand_bars()
	_setup_dev_right_click_hooks()

## ===========================
## NOISE TEXTURE SETUP
## ===========================

func _setup_noise() -> void:
	_noise_tex = NoiseTexture2D.new()
	_noise_tex.width = 200
	_noise_tex.height = 300
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.frequency = 0.04
	_noise_tex.noise = noise

func _load_icon_textures() -> void:
	_icon_atk = _load_texture_from_png(ICON_ATK_PATH)
	_icon_hp = _load_texture_from_png(ICON_HP_PATH)
	_icon_range = _load_texture_from_png(ICON_RANGE_PATH)
	_icon_mana = _load_texture_from_png(ICON_MANA_PATH)
	_icon_deck = _load_texture_from_png(ICON_DECK_PATH)
	_icon_graveyard = _load_texture_from_png(ICON_GRAVEYARD_PATH)
	_icon_rakas = _load_texture_from_png(ICON_RAKAS_PATH)

func _load_texture_from_png(path: String) -> Texture2D:
	var res = load(path)
	if res and res is Texture2D:
		return res as Texture2D
	push_warning("Icon not loaded: %s" % path)
	return null

func _create_icon_rect(icon: Texture2D, icon_size: int = 14) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = icon
	rect.custom_minimum_size = Vector2(icon_size, icon_size)
	rect.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect

func _setup_preview_icons() -> void:
	if not preview_stats_row:
		return
	var content = preview_title.get_parent()
	if content:
		var header := HBoxContainer.new()
		header.add_theme_constant_override("separation", 2)
		content.add_child(header)
		content.move_child(header, 0)
		_preview_cost_icon = _create_icon_rect(_icon_mana, 16)
		header.add_child(_preview_cost_icon)
		_preview_cost_label = Label.new()
		_preview_cost_label.add_theme_font_size_override("font_size", 16)
		_preview_cost_label.add_theme_color_override("font_color", Color(0.05, 0.05, 0.05))
		header.add_child(_preview_cost_label)
		content.remove_child(preview_title)
		header.add_child(preview_title)
		preview_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		preview_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	preview_stats_row.add_theme_constant_override("separation", 2)
	_preview_atk_icon = _create_icon_rect(_icon_atk, 16)
	_preview_mid_icon = _create_icon_rect(_icon_range, 16)
	_preview_def_icon = _create_icon_rect(_icon_hp, 16)
	preview_stats_row.add_child(_preview_atk_icon)
	preview_stats_row.move_child(_preview_atk_icon, 0)
	preview_stats_row.add_child(_preview_mid_icon)
	preview_stats_row.move_child(_preview_mid_icon, 2)
	preview_stats_row.add_child(_preview_def_icon)
	preview_stats_row.move_child(_preview_def_icon, preview_def_label.get_index())
	preview_atk_label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	preview_def_label.size_flags_horizontal = Control.SIZE_SHRINK_END
	preview_stats.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	preview_atk_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	preview_def_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	preview_stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	preview_atk_label.add_theme_font_size_override("font_size", 14)
	preview_stats.add_theme_font_size_override("font_size", 14)
	preview_def_label.add_theme_font_size_override("font_size", 14)

func _setup_preview_art_texture() -> void:
	if not preview_art:
		return
	_preview_art_texture = TextureRect.new()
	_preview_art_texture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_preview_art_texture.anchors_preset = Control.PRESET_FULL_RECT
	_preview_art_texture.anchor_right = 1.0
	_preview_art_texture.anchor_bottom = 1.0
	_preview_art_texture.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_preview_art_texture.grow_vertical = Control.GROW_DIRECTION_BOTH
	_preview_art_texture.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	_preview_art_texture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	preview_art.add_child(_preview_art_texture)

func _setup_info_bar_icons() -> void:
	var pairs: Array = [
		{"label": opponent_hp_label, "icon": _icon_hp},
		{"label": opponent_mana_label, "icon": _icon_mana},
		{"label": enemy_deck_count, "icon": _icon_deck},
		{"label": enemy_discard_count, "icon": _icon_graveyard},
		{"label": enemy_pile_count, "icon": _icon_rakas},
		{"label": player_hp_label, "icon": _icon_hp},
		{"label": player_mana_label, "icon": _icon_mana},
		{"label": player_deck_count, "icon": _icon_deck},
		{"label": player_discard_count, "icon": _icon_graveyard},
		{"label": player_pile_count, "icon": _icon_rakas},
	]
	for entry in pairs:
		var lbl: Label = entry["label"]
		if not lbl:
			continue
		var parent = lbl.get_parent()
		if not parent:
			continue
		var icon_rect := _create_icon_rect(entry["icon"], 13)
		parent.add_child(icon_rect)
		parent.move_child(icon_rect, lbl.get_index())

## ===========================
## CHARACTER SLOTS — 2 per player
## ===========================

func _setup_character_slots() -> void:
	for container in [opponent_chars, player_chars]:
		for child in container.get_children():
			child.queue_free()
		for i in range(2):
			var slot := PanelContainer.new()
			slot.custom_minimum_size = Vector2(110, 28)
			var ss := StyleBoxFlat.new()
			ss.bg_color = Color(0.08, 0.1, 0.14)
			ss.border_color = Color(0.25, 0.28, 0.32)
			ss.set_border_width_all(1)
			ss.set_corner_radius_all(3)
			ss.set_content_margin_all(3)
			slot.add_theme_stylebox_override("panel", ss)
			slot.mouse_filter = Control.MOUSE_FILTER_STOP
			var lbl := Label.new()
			lbl.text = "Üres"
			lbl.add_theme_font_size_override("font_size", 9)
			lbl.add_theme_color_override("font_color", Color(0.35, 0.37, 0.4))
			lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
			slot.add_child(lbl)
			var slot_index := i
			var target_type := "player_character" if container == player_chars else "enemy_character"
			var is_player: bool = (container == player_chars)
			slot.gui_input.connect(func(event: InputEvent) -> void:
				if event is InputEventMouseButton and event.pressed:
					if event.button_index == MOUSE_BUTTON_RIGHT:
						if _dev_menu and not _is_in_interactive_state():
							_dev_menu.show_context_menu(target_type, {"slot": slot_index}, event.global_position)
					elif event.button_index == MOUSE_BUTTON_LEFT and is_player:
						_on_character_slot_clicked(slot_index)
			)
			container.add_child(slot)

func _set_character_slot(container: HBoxContainer, index: int, card) -> void:
	if index < 0 or index >= container.get_child_count():
		return
	var slot := container.get_child(index) as PanelContainer
	if not slot:
		return
	var lbl := slot.get_child(0) as Label
	if not lbl:
		return
	if card:
		var has_activated: bool = false
		if card.get("abilities") and card.abilities is Array:
			for ab in card.abilities:
				if ab and ab.get("trigger") and ab.trigger.get("event") == "ACTIVATED":
					has_activated = true
					break
		lbl.text = ("⚡ " + card.card_name) if has_activated else card.card_name
		lbl.add_theme_color_override("font_color", Color(0.831, 0.659, 0.263))
		var c = card
		if not slot.mouse_entered.is_connected(_on_char_slot_hovered):
			slot.mouse_entered.connect(_on_char_slot_hovered.bind(c))
	else:
		lbl.text = "Üres"
		lbl.add_theme_color_override("font_color", Color(0.35, 0.37, 0.4))

func _on_char_slot_hovered(card) -> void:
	if card:
		_show_card_preview(card)

func _on_character_slot_clicked(slot_index: int) -> void:
	if not game_manager or not game_manager.is_player_turn():
		return
	if _is_in_interactive_state():
		return
	if slot_index < 0 or slot_index >= game_manager.player_characters.size():
		return
	var character = game_manager.player_characters[slot_index]
	if character == null:
		return
	# Check if character has an ACTIVATED ability
	var has_activated: bool = false
	if character.get("abilities") and character.abilities is Array:
		for ab in character.abilities:
			if ab and ab.get("trigger") and ab.trigger.get("event") == "ACTIVATED":
				has_activated = true
				break
	if not has_activated:
		_add_log("%s nem rendelkezik aktiválható képességgel." % character.card_name)
		return
	_add_log("⚡ %s képesség aktiválása..." % character.card_name)
	_dispatch_gm_action("ACTIVATE_ABILITY", {"row": -1, "col": slot_index, "ability_index": 0})

## ===========================
## GRID SETUP & SIZING
## ===========================

func _setup_grid() -> void:
	grid_cells.clear()
	grid_container.columns = GRID_COLS
	for row in range(GRID_ROWS):
		var row_cells: Array = []
		for col_idx in range(GRID_COLS):
			var cell := GridCell.new()
			cell.row = row
			cell.col = col_idx
			cell.custom_minimum_size = Vector2(80, 80)
			cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			cell.size_flags_vertical = Control.SIZE_EXPAND_FILL
			cell.cell_clicked.connect(_on_cell_clicked)
			cell.cell_hovered.connect(_on_cell_hovered)
			cell.cell_right_clicked.connect(_on_cell_right_clicked)
			grid_container.add_child(cell)
			row_cells.append(cell)
		grid_cells.append(row_cells)
	call_deferred("_resize_grid")

func _apply_grid_perspective() -> void:
	## Reorder GridContainer children so each player sees own base at bottom.
	## Player 1 (first): flip rows. Player 2 (second): flip columns.
	## grid_cells[data_row][data_col] always stays in DATA coordinates.
	# Remove all children from grid (don't free — we still reference them)
	while grid_container.get_child_count() > 0:
		grid_container.remove_child(grid_container.get_child(0))
	# Re-add in visual order
	for display_row in range(GRID_ROWS):
		for display_col in range(GRID_COLS):
			var data_row: int = (GRID_ROWS - 1 - display_row) if _perspective_flip_rows else display_row
			var data_col: int = (GRID_COLS - 1 - display_col) if _perspective_flip_cols else display_col
			grid_container.add_child(grid_cells[data_row][data_col])
	# Update coordinate labels
	for data_row in range(GRID_ROWS):
		for data_col in range(GRID_COLS):
			var label_text: String = "%s%d" % ["ABCDE"[data_col], data_row + 1]
			grid_cells[data_row][data_col].set_coordinate_text(label_text)
	call_deferred("_resize_grid")

func _resize_grid() -> void:
	if not center_panel or grid_cells.is_empty():
		return
	var avail := center_panel.size
	var margin_frac := 0.05
	var usable_w := avail.x * (1.0 - 2.0 * margin_frac)
	var usable_h := avail.y * (1.0 - 2.0 * margin_frac)
	var gap := 2
	var total_gap_w := gap * (GRID_COLS - 1)
	var total_gap_h := gap * (GRID_ROWS - 1)
	var cell_w: int = int(floorf((usable_w - float(total_gap_w)) / float(GRID_COLS)))
	var cell_h: int = int(floorf((usable_h - float(total_gap_h)) / float(GRID_ROWS)))
	var cell_size: int = maxi(mini(cell_w, cell_h), 30)
	_cell_size = cell_size
	for row_arr in grid_cells:
		for cell in row_arr:
			cell.custom_minimum_size = Vector2(cell_size, cell_size)
	_resize_hand_and_preview()

func _resize_hand_and_preview() -> void:
	var eh_bar = $MainLayout/RightSection/EnemyHandBar
	var ph_bar = $MainLayout/RightSection/PlayerHandBar
	eh_bar.custom_minimum_size.y = _cell_size
	ph_bar.custom_minimum_size.y = _cell_size
	card_preview.custom_minimum_size = Vector2(_cell_size * 2, _cell_size * 3)
	if game_manager:
		_refresh_hand()

## ===========================
## CELL INTERACTION — same for test and multiplayer
## ===========================

func _on_cell_clicked(row: int, col: int) -> void:
	if not game_manager:
		return
	# Block input when it's not my turn
	if not game_manager.is_player_turn():
		return

	# 1. Target mode: submit target
	if game_manager.is_awaiting_target():
		var target_result := _dispatch_gm_action("SUBMIT_TARGET", {"row": row, "col": col})
		if bool(target_result.get("ok", false)):
			_clear_target_highlights()
			_dismiss_targeting_banner()
			selected_hand_index = -1
			_refresh_grid()
			_refresh_hand()
			_update_counts()
			_check_victory()
			if game_manager.is_awaiting_target() or game_manager.is_awaiting_choice():
				_update_interactive_ui()
		return

	# 1b. Ring target mode: apply ring to allied unit
	if game_manager.is_awaiting_ring_target():
		var ring_result := _dispatch_gm_action("SUBMIT_RING_TARGET", {"row": row, "col": col})
		if bool(ring_result.get("ok", false)):
			_clear_target_highlights()
			_dismiss_targeting_banner()
			_refresh_grid()
			_refresh_hand()
			_update_counts()
		return

	# Block all other grid interactions during interactive states
	if game_manager.is_interactive_state_active():
		return

	# 2. Unit moving mode
	if _unit_action_state == 1:
		var move_result := _dispatch_gm_action("MOVE_UNIT", {
			"from_row": _selected_unit_row,
			"from_col": _selected_unit_col,
			"to_row": row,
			"to_col": col,
		})
		if bool(move_result.get("ok", false)):
			_cancel_unit_action()
			_refresh_grid()
		else:
			_cancel_unit_action()
		return

	# 3. Unit attacking mode
	if _unit_action_state == 2:
		var attack_result := _dispatch_gm_action("ATTACK_UNIT", {
			"atk_row": _selected_unit_row,
			"atk_col": _selected_unit_col,
			"def_row": row,
			"def_col": col,
		})
		if bool(attack_result.get("ok", false)):
			_cancel_unit_action()
			_refresh_grid()
			_update_counts()
			_check_victory()
		else:
			_cancel_unit_action()
		return

	# 4. Hand card selected: try to place unit/building
	if selected_hand_index >= 0:
		var card = game_manager.player_hand[selected_hand_index]
		if card and (card.card_type == CardScript.CardType.UNIT or card.card_type == CardScript.CardType.BUILDING):
			var play_unit_result := _dispatch_gm_action("PLAY_UNIT", {
				"hand_index": selected_hand_index,
				"row": row,
				"col": col,
			})
			if bool(play_unit_result.get("ok", false)):
				selected_hand_index = -1
				_refresh_grid()
				_refresh_hand()
				_update_counts()
				if not game_manager.is_awaiting_target() and not game_manager.is_awaiting_choice():
					_clear_target_highlights()
			return

	# 5. Nothing selected: check cell contents
	var unit = game_manager.get_unit_at(row, col)
	if unit:
		if unit.owner_id == 0:
			_show_unit_action_popup(row, col)
		else:
			_show_unit_preview(unit)

func _on_cell_hovered(row: int, col: int) -> void:
	if not game_manager:
		return
	var unit = game_manager.get_unit_at(row, col)
	if unit:
		_show_unit_preview(unit)

## ===========================
## START MULTIPLAYER GAME — uses the same game_manager, no separate logic!
## ===========================

func start_multiplayer_game(lobby_id: String, auth_token: String, user_id: int, dev_mode_flag: bool = false) -> void:
	_mp_mode = true
	dev_mode = dev_mode_flag
	_mp_lobby_id = lobby_id
	_mp_token = auth_token
	_mp_user_id = user_id

	CardDatabaseScript.init()

	# Determine base URL
	var bridge := get_node_or_null("/root/JSBridge")
	if bridge and bridge.is_web:
		var origin = JavaScriptBridge.eval("window.location.origin")
		_mp_base_url = str(origin) if origin else "http://localhost:3000"
	else:
		_mp_base_url = "http://localhost:3000"

	# Setup HTTP request nodes
	_mp_http_poll = HTTPRequest.new()
	_mp_http_poll.name = "MPHttpPoll"
	_mp_http_poll.request_completed.connect(_on_mp_poll_completed)
	add_child(_mp_http_poll)

	_mp_http_sync = HTTPRequest.new()
	_mp_http_sync.name = "MPHttpSync"
	_mp_http_sync.request_completed.connect(_on_mp_sync_completed)
	add_child(_mp_http_sync)

	# Poll timer (frequent interval for near-real-time sync)
	_mp_poll_timer = Timer.new()
	_mp_poll_timer.name = "MPPollTimer"
	_mp_poll_timer.wait_time = 0.35
	_mp_poll_timer.timeout.connect(_mp_poll_game_state)
	add_child(_mp_poll_timer)

	turn_label.text = "Multiplayer"
	opponent_name_label.text = "Ellenfél"
	player_name_label.text = "Te"
	end_turn_button.text = "Kör vége"
	_add_log("Multiplayer mód: lobby=%s" % lobby_id)

	# Initial poll to get setup data, then start timer
	_mp_poll_game_state()
	_mp_poll_timer.start()

## ===========================
## UI REFRESH
## ===========================

func _refresh_grid() -> void:
	if not game_manager:
		return
	_rebuild_known_cards_cache()
	_sync_arena_state_from_manager()
	var board: Array = arena_state.get("grid", game_manager.grid)
	for row in range(GRID_ROWS):
		for col in range(GRID_COLS):
			var cell = grid_cells[row][col]
			var unit = null
			if row >= 0 and row < board.size() and col >= 0 and col < board[row].size():
				unit = board[row][col]
			if unit:
				cell.place_card(unit.card)
				cell.set_unit_display(unit)
			else:
				if not cell.is_empty():
					cell.remove_card()

func _refresh_hand() -> void:
	if not game_manager:
		return
	_rebuild_known_cards_cache()
	_sync_arena_state_from_manager()
	var state_hand: Array = arena_state.get("player_hand", game_manager.player_hand)
	for child in player_hand.get_children():
		child.queue_free()
	_hand_items.clear()

	if _player_showing_bench:
		var discard_cards: Array = arena_state.get("player_discard", game_manager.player_discard)
		var pile_cards: Array = arena_state.get("player_pile", game_manager.player_pile)
		_add_bench_section(player_hand, "Temető", _icon_graveyard, discard_cards)
		_add_bench_section(player_hand, "Rakás", _icon_rakas, pile_cards)
		# Show rings on bench
		_add_ring_buttons(player_hand)
		if discard_cards.is_empty() and pile_cards.is_empty() and game_manager.player_rings <= 0:
			var placeholder := Label.new()
			placeholder.text = "Temető és rakás üres"
			placeholder.add_theme_font_size_override("font_size", 14)
			placeholder.add_theme_color_override("font_color", Color(0.35, 0.37, 0.42))
			placeholder.mouse_filter = Control.MOUSE_FILTER_IGNORE
			placeholder.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			placeholder.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			placeholder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			placeholder.size_flags_vertical = Control.SIZE_EXPAND_FILL
			player_hand.add_child(placeholder)
		_update_counts()
		return

	for i in range(state_hand.size()):
		var card = state_hand[i]
		var card_panel := _create_hand_card(card, i)
		player_hand.add_child(card_panel)
		_hand_items.append(card_panel)

	# Show ring buttons in hand view too
	_add_ring_buttons(player_hand)

	_update_counts()

func _add_bench_section(container: HBoxContainer, title: String, icon: Texture2D, cards: Array) -> void:
	if cards.is_empty():
		return
	for card in cards:
		container.add_child(_create_bench_card(card, title, icon))

func _add_ring_buttons(container: HBoxContainer) -> void:
	## Show clickable ring items in the hand/bench area.
	if not game_manager or game_manager.player_rings <= 0:
		return
	# Add a separator
	var sep := VSeparator.new()
	sep.custom_minimum_size = Vector2(2, 0)
	sep.add_theme_color_override("separator", Color(0.831, 0.659, 0.263, 0.4))
	container.add_child(sep)
	# Add one button per ring
	for i in range(game_manager.player_rings):
		var ring_btn := Button.new()
		var btn_size: int = maxi(_cell_size - 14, 50)
		ring_btn.custom_minimum_size = Vector2(btn_size, btn_size)
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.12, 0.1, 0.05)
		s.border_color = Color(0.831, 0.659, 0.263)
		s.set_border_width_all(2)
		s.set_corner_radius_all(20)
		s.set_content_margin_all(4)
		ring_btn.add_theme_stylebox_override("normal", s)
		var s_hover := s.duplicate()
		s_hover.bg_color = Color(0.2, 0.16, 0.06)
		s_hover.border_color = Color(1.0, 0.85, 0.4)
		s_hover.set_border_width_all(3)
		ring_btn.add_theme_stylebox_override("hover", s_hover)
		ring_btn.text = "💍"
		ring_btn.add_theme_font_size_override("font_size", 18)
		ring_btn.tooltip_text = "Gyűrű: +1/+1 egy szövetséges egységre"
		ring_btn.pressed.connect(func() -> void:
			if game_manager and game_manager.is_player_turn():
				_dispatch_gm_action("USE_RING")
		)
		container.add_child(ring_btn)

func _create_bench_card(card: Resource, title: String, icon: Texture2D) -> PanelContainer:
	var panel := PanelContainer.new()
	var card_size: int = maxi(_cell_size - 14, 50)
	panel.custom_minimum_size = Vector2(card_size, card_size)
	panel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var bg_style := StyleBoxFlat.new()
	bg_style.set_corner_radius_all(3)
	bg_style.set_content_margin_all(3)
	bg_style.bg_color = Color(0.07, 0.08, 0.1)
	bg_style.border_color = Color(0.2, 0.22, 0.28)
	bg_style.set_border_width_all(1)
	panel.add_theme_stylebox_override("panel", bg_style)

	var vbox := VBoxContainer.new()
	vbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vbox.add_theme_constant_override("separation", 2)
	panel.add_child(vbox)

	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 2)
	vbox.add_child(top)
	top.add_child(_create_icon_rect(icon, 12))
	var where_lbl := Label.new()
	where_lbl.text = title
	where_lbl.add_theme_font_size_override("font_size", 10)
	where_lbl.add_theme_color_override("font_color", Color(0.6, 0.63, 0.67))
	top.add_child(where_lbl)

	var name_lbl := Label.new()
	name_lbl.text = card.card_name
	name_lbl.clip_text = true
	name_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_lbl.add_theme_font_size_override("font_size", 11)
	vbox.add_child(name_lbl)

	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.mouse_entered.connect(func() -> void:
		_show_card_preview(card)
	)

	return panel

func _create_hand_card(card: Resource, index: int) -> PanelContainer:
	var can_play: bool = game_manager.can_play_card_with_modifiers(index)
	var is_sel: bool = (index == selected_hand_index)

	# In hand card targeting mode (Mozgósítás), override can_play:
	# only valid target cards are interactable
	var in_hand_target_mode: bool = game_manager.is_awaiting_hand_card()
	var in_discard_mode: bool = game_manager.is_awaiting_discard_from_hand()
	if in_hand_target_mode:
		var valid_indices: Array = game_manager.get_hand_card_valid_indices()
		can_play = index in valid_indices
		is_sel = false  # Don't show selection highlight in targeting mode
	elif in_discard_mode:
		can_play = true  # All cards can be discarded
		is_sel = false

	var card_class: String = card.card_class if card.get("card_class") else ""
	var palette := _get_class_palette(card_class)

	var card_size: int = maxi(_cell_size - 14, 50)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(card_size, card_size)
	panel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	panel.mouse_filter = Control.MOUSE_FILTER_STOP

	var bg_style := StyleBoxFlat.new()
	bg_style.set_corner_radius_all(3)
	bg_style.set_content_margin_all(3)
	if is_sel:
		bg_style.bg_color = palette["card_bg"].lerp(Color(0.2, 0.5, 0.15), 0.3)
		bg_style.border_color = Color(0.4, 0.95, 0.3)
		bg_style.set_border_width_all(2)
	elif can_play:
		bg_style.bg_color = palette["card_bg"].lerp(Color(0.05, 0.06, 0.08), 0.5)
		bg_style.border_color = palette["border"]
		bg_style.set_border_width_all(1)
	else:
		bg_style.bg_color = Color(0.06, 0.07, 0.09)
		bg_style.border_color = Color(0.15, 0.16, 0.18)
		bg_style.set_border_width_all(1)
	panel.add_theme_stylebox_override("panel", bg_style)

	var vbox := VBoxContainer.new()
	vbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vbox.add_theme_constant_override("separation", 0)
	panel.add_child(vbox)

	# Top row: cost left, name right
	var top_row := HBoxContainer.new()
	top_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top_row.add_theme_constant_override("separation", 2)
	vbox.add_child(top_row)

	if card.card_type != CardScript.CardType.CHARACTER:
		top_row.add_child(_create_icon_rect(_icon_mana, 8))
		var shown_cost: int = card.cost
		if game_manager:
			shown_cost = game_manager.get_hand_card_effective_cost(index)
		var cost_lbl := Label.new()
		cost_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
		cost_lbl.text = str(shown_cost)
		cost_lbl.add_theme_font_size_override("font_size", 15)
		cost_lbl.add_theme_color_override("font_color",
			Color(0.9, 0.93, 0.96) if can_play else Color(0.4, 0.4, 0.45))
		top_row.add_child(cost_lbl)

	var name_lbl := Label.new()
	name_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	name_lbl.text = card.card_name
	name_lbl.add_theme_font_size_override("font_size", 11)
	name_lbl.add_theme_color_override("font_color",
		Color(0.9, 0.93, 0.96) if can_play else Color(0.4, 0.4, 0.45))
	name_lbl.clip_text = true
	name_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	top_row.add_child(name_lbl)

	# Art area
	var art := ColorRect.new()
	art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	art.color = palette["art"] if can_play else palette["art"].lerp(Color(0.05, 0.05, 0.05), 0.6)
	art.size_flags_vertical = Control.SIZE_EXPAND_FILL
	art.custom_minimum_size = Vector2(0, 14)
	vbox.add_child(art)
	if card.get("art_path") and String(card.art_path).strip_edges() != "":
		var p := String(card.art_path).strip_edges()
		if ResourceLoader.exists(p):
			var tex_res = load(p)
			if tex_res and tex_res is Texture2D:
				var tex := TextureRect.new()
				tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
				tex.texture = tex_res as Texture2D
				tex.anchors_preset = Control.PRESET_FULL_RECT
				tex.anchor_right = 1.0
				tex.anchor_bottom = 1.0
				tex.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
				tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
				art.add_child(tex)

	# Bottom: atk/hp for units
	if card.card_type == CardScript.CardType.UNIT:
		var bottom := HBoxContainer.new()
		bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bottom.add_theme_constant_override("separation", 2)
		vbox.add_child(bottom)

		bottom.add_child(_create_icon_rect(_icon_atk, 12))
		var atk := Label.new()
		atk.mouse_filter = Control.MOUSE_FILTER_IGNORE
		atk.text = str(card.attack)
		atk.add_theme_font_size_override("font_size", 14)
		atk.add_theme_color_override("font_color", Color(1.0, 0.85, 0.4))
		atk.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		atk.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		bottom.add_child(atk)

		bottom.add_child(_create_icon_rect(_icon_hp, 12))
		var def_lbl := Label.new()
		def_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
		def_lbl.text = str(card.hp)
		def_lbl.add_theme_font_size_override("font_size", 14)
		def_lbl.add_theme_color_override("font_color", Color(1.0, 0.4, 0.4))
		def_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		def_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		bottom.add_child(def_lbl)

	# Input events
	var idx := index
	panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed:
			if event.button_index == MOUSE_BUTTON_LEFT:
				_on_hand_card_clicked(idx)
			elif event.button_index == MOUSE_BUTTON_RIGHT:
				if _dev_menu and not _is_in_interactive_state():
					_dev_menu.show_context_menu("hand_card", {"hand_index": idx}, event.global_position)
				else:
					_cancel_all()
	)
	panel.mouse_entered.connect(func() -> void:
		hovered_hand_index = idx
		_show_card_preview(card, idx)
		# Show range highlights on hover
		if can_play and selected_hand_index == -1 and _unit_action_state == 0:
			_clear_target_highlights()
			if game_manager:
				if card.card_type == CardScript.CardType.UNIT or card.card_type == CardScript.CardType.BUILDING:
					var valid = game_manager.get_valid_placement_tiles()
					for pos in valid:
						grid_cells[pos.x][pos.y].set_target_highlight(true)
				elif _is_hand_card_action_type(card):
					for ab in card.abilities:
						if ab and ab.targeting_mode == AbilityScript.TargetingMode.PLAYER_CHOICE:
							var valid = game_manager.get_valid_spell_tiles(ab.effect_range, ab.valid_target_1, ab.valid_target_2)
							for pos in valid:
								grid_cells[pos.x][pos.y].set_target_highlight(true)
							break
		if can_play and not is_sel:
			var hs := bg_style.duplicate()
			hs.border_color = Color(0.3, 0.7, 0.2)
			hs.set_border_width_all(2)
			panel.add_theme_stylebox_override("panel", hs)
	)
	panel.mouse_exited.connect(func() -> void:
		if hovered_hand_index == idx:
			hovered_hand_index = -1
		panel.add_theme_stylebox_override("panel", bg_style)
		if selected_hand_index == -1 and _unit_action_state == 0 and (not game_manager or not game_manager.is_awaiting_target()):
			_clear_target_highlights()
	)
	return panel

func _update_counts() -> void:
	if game_manager:
		_sync_arena_state_from_manager()
		var player_state: Dictionary = arena_state.get("player", {})
		var enemy_state: Dictionary = arena_state.get("enemy", {})
		player_deck_count.text = str(int(player_state.get("deck_count", 0)))
		player_discard_count.text = str(int(player_state.get("discard_count", 0)))
		player_pile_count.text = str(int(player_state.get("pile_count", 0)))
		player_hp_label.text = str(int(player_state.get("hp", 20)))
		player_mana_label.text = "%d/%d" % [int(player_state.get("mana", 0)), int(player_state.get("max_mana", 0))]
		var tn: int = int(arena_state.get("turn_number", 0))
		var dev_prefix: String = "[DEV] " if dev_mode else ""
		if game_manager.is_player_turn():
			turn_label.text = "%s%d. kör — TE JÖSSZ" % [dev_prefix, tn]
			end_turn_button.disabled = false
		else:
			turn_label.text = "%s%d. kör — Várakozás..." % [dev_prefix, tn]
			end_turn_button.disabled = true
		opponent_hp_label.text = str(int(enemy_state.get("hp", 20)))
		opponent_mana_label.text = "%d/%d" % [int(enemy_state.get("mana", 0)), int(enemy_state.get("max_mana", 0))]
		enemy_deck_count.text = str(int(enemy_state.get("deck_count", game_manager.enemy_deck_ids.size())))
		enemy_discard_count.text = str(int(enemy_state.get("discard_count", game_manager.enemy_discard_ids.size())))
		enemy_pile_count.text = str(int(enemy_state.get("pile_count", game_manager.enemy_pile_ids.size())))
		_refresh_enemy_hand()
		# Update character slots
		if game_manager.player_characters.size() > 0:
			for i in range(mini(game_manager.player_characters.size(), 2)):
				_set_character_slot(player_chars, i, game_manager.player_characters[i])
		if game_manager.enemy_characters.size() > 0:
			for i in range(mini(game_manager.enemy_characters.size(), 2)):
				_set_character_slot(opponent_chars, i, game_manager.enemy_characters[i])
	else:
		player_deck_count.text = "0"
		player_discard_count.text = "0"
		player_pile_count.text = "0"
		player_hp_label.text = "20"
		player_mana_label.text = "0/0"
		opponent_hp_label.text = "20"
		opponent_mana_label.text = "?/?"
		enemy_deck_count.text = "0"
		enemy_discard_count.text = "0"
		enemy_pile_count.text = "0"

## ===========================
## CARD PREVIEW — 3:2 (h:w) ratio, perlin noise base
## ===========================

func _show_card_preview(card: Resource, _hand_index: int = -1) -> void:
	if not card:
		_clear_preview()
		return
	var card_class: String = card.card_class if card.get("card_class") else ""
	var palette := _get_class_palette(card_class)

	var pstyle := StyleBoxFlat.new()
	pstyle.bg_color = palette["card_bg"]
	pstyle.border_color = palette["border"]
	pstyle.set_border_width_all(3)
	pstyle.set_corner_radius_all(0)
	pstyle.set_content_margin_all(6)
	card_preview.add_theme_stylebox_override("panel", pstyle)

	preview_title.text = card.card_name
	if card.card_type == CardScript.CardType.CHARACTER:
		if _preview_cost_icon:
			_preview_cost_icon.visible = false
		if _preview_cost_label:
			_preview_cost_label.visible = false
	else:
		if _preview_cost_icon:
			_preview_cost_icon.visible = true
		if _preview_cost_label:
			_preview_cost_label.visible = true
			var shown_cost: int = card.cost
			if game_manager and _hand_index >= 0:
				shown_cost = game_manager.get_hand_card_effective_cost(_hand_index)
			_preview_cost_label.text = str(shown_cost)
	preview_title.add_theme_color_override("font_color", Color(0.05, 0.05, 0.05))
	preview_art.color = palette["art"]
	if _preview_art_texture:
		_preview_art_texture.texture = null
	if card.get("art_path") and String(card.art_path).strip_edges() != "":
		var apath := String(card.art_path).strip_edges()
		if ResourceLoader.exists(apath):
			var ares = load(apath)
			if ares and ares is Texture2D and _preview_art_texture:
				_preview_art_texture.texture = ares as Texture2D

	preview_type.text = _build_type_tag_line(card)
	preview_type.add_theme_color_override("font_color", Color(0.05, 0.05, 0.05))

	var desc_text := ""
	if card.get("description") and String(card.description).strip_edges() != "":
		desc_text = String(card.description).strip_edges()
	elif card.has_method("get_ability_text"):
		desc_text = String(card.get_ability_text()).strip_edges()
	var flavor_text := ""
	if card.get("flavor_text"):
		flavor_text = String(card.flavor_text).strip_edges()

	var body_parts: Array[String] = []
	if desc_text != "":
		body_parts.append(_escape_bbcode(desc_text))
	if flavor_text != "":
		body_parts.append("[font_size=10][i]%s[/i][/font_size]" % _escape_bbcode(flavor_text))
	if card.card_type == CardScript.CardType.UNIT:
		body_parts.append("[img=14x14]%s[/img] %s     [img=14x14]%s[/img] %s" % [ICON_ATK_PATH, str(card.attack), ICON_HP_PATH, str(card.hp)])
	preview_ability.text = "\n\n".join(body_parts)
	preview_ability.visible = preview_ability.text != ""
	preview_ability.add_theme_color_override("default_color", Color(0.05, 0.05, 0.05))
	var ab_style := StyleBoxFlat.new()
	ab_style.bg_color = palette["text_bg"]
	ab_style.border_color = palette["border"]
	ab_style.set_border_width_all(1)
	ab_style.set_corner_radius_all(0)
	ab_style.set_content_margin_all(8)
	preview_ability.add_theme_stylebox_override("normal", ab_style)
	if preview_sep:
		preview_sep.visible = false
	if preview_stats_row:
		preview_stats_row.visible = false

	match card.card_type:
		CardScript.CardType.UNIT:
			_preview_atk_icon.visible = false
			_preview_def_icon.visible = false
			_preview_mid_icon.visible = false
			preview_stats.text = ""
		CardScript.CardType.SPELL:
			_preview_atk_icon.visible = false
			_preview_def_icon.visible = false
			_preview_mid_icon.visible = false
			preview_atk_label.text = ""
			preview_def_label.text = ""
			preview_stats.text = ""
		CardScript.CardType.CHARACTER:
			_preview_atk_icon.visible = false
			_preview_mid_icon.visible = false
			_preview_def_icon.visible = false
			preview_atk_label.text = ""
			preview_def_label.text = ""
			preview_stats.text = ""
		_:
			_preview_atk_icon.visible = false
			_preview_mid_icon.visible = false
			_preview_def_icon.visible = false
			preview_atk_label.text = ""
			preview_def_label.text = ""
			preview_stats.text = ""

	preview_stats.add_theme_color_override("font_color", Color(0.05, 0.05, 0.05))
	preview_atk_label.add_theme_color_override("font_color", Color(0.05, 0.05, 0.05))
	preview_def_label.add_theme_color_override("font_color", Color(0.05, 0.05, 0.05))

func _build_type_tag_line(card: Resource) -> String:
	var type_text := _get_display_type_name(card)
	var tags_text: Array[String] = []
	if card.get("tags") and card.tags is Array:
		for tag in card.tags:
			var t := String(tag).strip_edges()
			if t != "":
				tags_text.append(t)
	if tags_text.size() > 0:
		return "%s - %s" % [type_text, " ".join(tags_text)]
	return type_text

func _get_display_type_name(card: Resource) -> String:
	match card.card_type:
		CardScript.CardType.UNIT:
			return "Egység"
		CardScript.CardType.CHARACTER:
			return "Karakter"
		CardScript.CardType.SPELL:
			if card.has_method("get_spell_type_name"):
				var s := String(card.get_spell_type_name()).strip_edges()
				if s != "":
					return s
			return "Varázslat"
		_:
			if card.has_method("get_type_name"):
				return String(card.get_type_name())
			return "Kártya"

func _is_hand_card_action_type(card) -> bool:
	if card == null:
		return false
	return card.card_type != CardScript.CardType.UNIT and card.card_type != CardScript.CardType.BUILDING and card.card_type != CardScript.CardType.CHARACTER

func _escape_bbcode(text: String) -> String:
	return text.replace("[", "\\[").replace("]", "\\]")

func _show_unit_preview(unit) -> void:
	if not unit or not unit.card:
		return
	_show_card_preview(unit.card)
	_preview_atk_icon.texture = _icon_atk
	_preview_def_icon.texture = _icon_hp
	_preview_atk_icon.visible = true
	_preview_def_icon.visible = true
	preview_atk_label.text = str(unit.get_effective_attack())
	preview_def_label.text = str(unit.get_effective_hp())
	var info_parts: Array[String] = []
	if unit.is_damaged():
		info_parts.append("Sérült")
	if unit.rings > 0:
		info_parts.append("Gyűrűk: %d" % unit.rings)
	_preview_mid_icon.visible = false
	var status_text := _build_unit_status_bar(unit)
	if status_text != "":
		preview_stats.text = status_text
	elif info_parts.size() > 0:
		preview_stats.text = "   ".join(info_parts)
	else:
		preview_stats.text = ""
	preview_stats.add_theme_color_override("font_color",
		Color(0.6, 0.15, 0.1) if unit.owner_id == 1 else Color(0.1, 0.3, 0.55))

func _build_card_status_bar(card: Resource) -> String:
	var parts: Array[String] = []
	if card.get("tags") and card.tags is Array:
		for tag in card.tags:
			if str(tag) != "":
				parts.append(_short_status_text(str(tag)))
	for ab in card.abilities:
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
		elif trig_event == "ON_TURN_START":
			parts.append("⏲")
	if parts.size() == 0:
		return ""
	return " ".join(parts)

func _build_unit_status_bar(unit) -> String:
	var parts: Array[String] = []
	for kw in unit.keywords:
		parts.append(_short_status_text(str(kw)))
	parts.append_array(_build_card_status_bar(unit.card).split(" ", false))
	parts = parts.filter(func(v): return str(v) != "")
	if parts.size() == 0:
		return ""
	return " ".join(parts)

func _short_status_text(text: String) -> String:
	var lower := text.to_lower()
	if lower.contains("pajzs") or lower.contains("shield"):
		return "🛡"
	if lower.contains("stun") or lower.contains("káb"):
		return "💫"
	if lower.contains("halál"):
		return "☠"
	if lower.contains("kör vége"):
		return "⏳"
	if lower.contains("csap"):
		return "⚔"
	return text.left(3)

func _clear_preview() -> void:
	preview_title.text = ""
	preview_art.color = Color(0.07, 0.09, 0.12)
	if _preview_art_texture:
		_preview_art_texture.texture = null
	preview_type.text = ""
	preview_ability.text = ""
	preview_ability.remove_theme_stylebox_override("normal")
	preview_ability.visible = false
	if preview_sep:
		preview_sep.visible = false
	if preview_stats_row:
		preview_stats_row.visible = false
	preview_stats.text = ""
	preview_atk_label.text = ""
	preview_def_label.text = ""
	if _preview_cost_icon:
		_preview_cost_icon.visible = false
	if _preview_cost_label:
		_preview_cost_label.visible = false
		_preview_cost_label.text = ""
	if _preview_atk_icon:
		_preview_atk_icon.visible = false
	if _preview_mid_icon:
		_preview_mid_icon.visible = false
	if _preview_def_icon:
		_preview_def_icon.visible = false
	var ps := StyleBoxFlat.new()
	ps.bg_color = Color(0.07, 0.09, 0.12)
	ps.border_color = Color(0.2, 0.22, 0.28)
	ps.set_border_width_all(1)
	ps.set_corner_radius_all(4)
	ps.set_content_margin_all(6)
	card_preview.add_theme_stylebox_override("panel", ps)

## ===========================
## CLASS PALETTES
## ===========================

const CLASS_PALETTES := {
	"Harcos": {
		"border": Color(0.553, 0.035, 0.035),
		"art": Color(0.4, 0.05, 0.05),
		"type_bar": Color(0.824, 0.478, 0.478),
		"text_bg": Color(0.976, 0.855, 0.855),
		"card_bg": Color(0.824, 0.478, 0.478),
	},
	"Mágus": {
		"border": Color(0.118, 0.435, 0.722),
		"art": Color(0.1, 0.3, 0.55),
		"type_bar": Color(0.494, 0.776, 0.961),
		"text_bg": Color(0.851, 0.941, 1.0),
		"card_bg": Color(0.494, 0.776, 0.961),
	},
	"Vaják": {
		"border": Color(0.220, 0.463, 0.114),
		"art": Color(0.15, 0.35, 0.1),
		"type_bar": Color(0.608, 0.8, 0.541),
		"text_bg": Color(0.875, 0.953, 0.824),
		"card_bg": Color(0.608, 0.8, 0.541),
	},
	"Zsivány": {
		"border": Color(0.337, 0.337, 0.337),
		"art": Color(0.25, 0.25, 0.25),
		"type_bar": Color(0.722, 0.722, 0.722),
		"text_bg": Color(0.902, 0.902, 0.902),
		"card_bg": Color(0.722, 0.722, 0.722),
	},
	"Bölcs": {
		"border": Color(0.651, 0.369, 0.494),
		"art": Color(0.45, 0.25, 0.35),
		"type_bar": Color(0.918, 0.710, 0.784),
		"text_bg": Color(0.976, 0.902, 0.941),
		"card_bg": Color(0.918, 0.710, 0.784),
	},
	"Garabonciás": {
		"border": Color(0.298, 0.165, 0.522),
		"art": Color(0.22, 0.12, 0.4),
		"type_bar": Color(0.710, 0.616, 0.906),
		"text_bg": Color(0.890, 0.847, 1.0),
		"card_bg": Color(0.710, 0.616, 0.906),
	},
	"Csodatevő": {
		"border": Color(0.85, 0.5, 0.1),
		"art": Color(0.6, 0.35, 0.08),
		"type_bar": Color(0.95, 0.72, 0.4),
		"text_bg": Color(1.0, 0.92, 0.78),
		"card_bg": Color(0.95, 0.72, 0.4),
	},
}
const DEFAULT_PALETTE := {
	"border": Color(0.4, 0.4, 0.4),
	"art": Color(0.25, 0.25, 0.3),
	"type_bar": Color(0.55, 0.55, 0.6),
	"text_bg": Color(0.82, 0.82, 0.85),
	"card_bg": Color(0.7, 0.7, 0.75),
}

func _get_class_palette(card_class: String) -> Dictionary:
	if CLASS_PALETTES.has(card_class):
		return CLASS_PALETTES[card_class]
	return DEFAULT_PALETTE

## ===========================
## HAND INTERACTION — unified
## ===========================

func _on_hand_card_clicked(index: int) -> void:
	if not game_manager:
		return
	if not game_manager.is_player_turn():
		_add_log("Nem a te köröd!")
		return

	# Handle hand card targeting mode (Mozgósítás)
	if game_manager.is_awaiting_hand_card():
		var result := _dispatch_gm_action("SUBMIT_HAND_CARD", {"hand_index": index})
		if bool(result.get("ok", false)):
			_dismiss_targeting_banner()
			_refresh_hand()
			_refresh_grid()
			_update_counts()
			_update_interactive_ui()
		return

	# Handle discard from hand selection (Lomtalanítás, Bolyongó)
	if game_manager.is_awaiting_discard_from_hand():
		var discard_ok: bool = bool(game_manager.submit_discard_from_hand(index))
		if discard_ok:
			_dismiss_targeting_banner()
			_refresh_hand()
			_refresh_grid()
			_update_counts()
			_update_interactive_ui()
		return

	# Block hand card selection during other interactive states (targeting/choosing)
	if game_manager.is_interactive_state_active():
		return

	var card = game_manager.player_hand[index]

	# Toggle selection
	if selected_hand_index == index:
		_cancel_all()
		return

	_cancel_pending_state()
	selected_hand_index = index
	_refresh_hand()

	if card and _is_hand_card_action_type(card):
		var play_spell_result := _dispatch_gm_action("PLAY_SPELL", {"hand_index": index})
		if bool(play_spell_result.get("ok", false)):
			if not game_manager.is_awaiting_choice() and not game_manager.is_awaiting_target():
				selected_hand_index = -1
				_refresh_hand()
				_refresh_grid()
				_update_counts()
				_check_victory()
		else:
			selected_hand_index = -1
			_refresh_hand()
	elif card and (card.card_type == CardScript.CardType.UNIT or card.card_type == CardScript.CardType.BUILDING):
		_clear_target_highlights()
		var valid_tiles: Array = game_manager.get_valid_placement_tiles()
		for pos in valid_tiles:
			grid_cells[pos.x][pos.y].set_target_highlight(true)
		_add_log("Válassz mezőt %s lehelyezéséhez! (Költség: %d)" % [card.card_name, card.cost])

## ===========================
## ENEMY PLAYER TARGETING — unified
## ===========================

func _on_enemy_player_clicked() -> void:
	if not game_manager:
		return
	if not game_manager.is_player_turn():
		return
	# If a unit is in attack mode
	if _unit_action_state == 2:
		var atk_player_result := _dispatch_gm_action("ATTACK_PLAYER", {
			"row": _selected_unit_row,
			"col": _selected_unit_col,
		})
		if bool(atk_player_result.get("ok", false)):
			_cancel_unit_action()
			_refresh_grid()
			_update_counts()
			_check_victory()
		else:
			_add_log("Ez az egység nem tudja közvetlenül támadni az ellenfelet!")
		return
	# If a spell target is awaited, try targeting enemy player
	if game_manager.is_awaiting_target():
		var target_player_result := _dispatch_gm_action("SUBMIT_TARGET_PLAYER")
		if bool(target_player_result.get("ok", false)):
			_clear_target_highlights()
			_dismiss_targeting_banner()
			selected_hand_index = -1
			_refresh_grid()
			_refresh_hand()
			_update_counts()
			_check_victory()
			_update_interactive_ui()
		return
	# Block other interactions during interactive states
	if game_manager.is_interactive_state_active():
		return
	# Otherwise show char preview
	if game_manager.player_characters.size() > 0:
		_show_card_preview(game_manager.player_characters[0])

func _on_self_player_clicked() -> void:
	if not game_manager:
		return
	if not game_manager.is_player_turn():
		return
	# If a spell target is awaited, try targeting self player
	if game_manager.is_awaiting_target():
		var target_self_result := _dispatch_gm_action("SUBMIT_TARGET_SELF_PLAYER")
		if bool(target_self_result.get("ok", false)):
			_clear_target_highlights()
			_dismiss_targeting_banner()
			selected_hand_index = -1
			_refresh_grid()
			_refresh_hand()
			_update_counts()
			_check_victory()
			_update_interactive_ui()
		return
	# Block other interactions during interactive states
	if game_manager.is_interactive_state_active():
		return
	# Otherwise show own char preview
	if game_manager.player_characters.size() > 0:
		_show_card_preview(game_manager.player_characters[0])

## ===========================
## CANCEL / DESELECT
## ===========================

func _cancel_all() -> void:
	_dismiss_choice_panel()
	_dismiss_steal_panel()
	_dismiss_command_target_popup()
	_cancel_unit_action()
	if game_manager:
		if game_manager.is_awaiting_choice():
			game_manager.cancel_choice()
		if game_manager.is_awaiting_target():
			game_manager.cancel_target()
		if game_manager.is_awaiting_ring_target():
			game_manager.cancel_ring_target()
		if game_manager.is_awaiting_hand_card():
			game_manager.skip_hand_card_selection()
	_clear_target_highlights()
	selected_hand_index = -1
	_refresh_hand()

func _cancel_pending_state() -> void:
	_dismiss_choice_panel()
	_dismiss_steal_panel()
	_dismiss_command_target_popup()
	_cancel_unit_action()
	if game_manager:
		if game_manager.is_awaiting_choice():
			game_manager.cancel_choice()
		if game_manager.is_awaiting_target():
			game_manager.cancel_target()
		if game_manager.is_awaiting_ring_target():
			game_manager.cancel_ring_target()
		if game_manager.is_awaiting_hand_card():
			game_manager.skip_hand_card_selection()
	_clear_target_highlights()
	_dismiss_targeting_banner()

## ===========================
## TARGETING BANNER & INTERACTIVE STATE UI
## ===========================

var _targeting_banner: Control = null

func _show_targeting_banner(text: String) -> void:
	_dismiss_targeting_banner()
	_targeting_banner = PanelContainer.new()
	_targeting_banner.name = "TargetingBanner"
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.15, 0.08, 0.02, 0.92)
	style.border_color = Color(1.0, 0.7, 0.15)
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	style.set_content_margin_all(8)
	_targeting_banner.add_theme_stylebox_override("panel", style)
	_targeting_banner.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var lbl := Label.new()
	lbl.text = text
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.add_theme_font_size_override("font_size", 14)
	lbl.add_theme_color_override("font_color", Color(1.0, 0.85, 0.3))
	lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_targeting_banner.add_child(lbl)

	add_child(_targeting_banner)
	# Position at top center
	_targeting_banner.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_targeting_banner.position.y = 8

func _dismiss_targeting_banner() -> void:
	if _targeting_banner:
		_targeting_banner.queue_free()
		_targeting_banner = null

func _update_interactive_ui() -> void:
	## Update end turn button and UI state based on interactive state.
	if not game_manager:
		return
	if game_manager.is_interactive_state_active():
		end_turn_button.disabled = true
		if game_manager.is_awaiting_target():
			_show_targeting_banner("🎯 Válassz célpontot! [Jobb klikk: Mégse]")
		elif game_manager.is_awaiting_choice():
			_show_targeting_banner("⚡ Válassz egy opciót!")
		elif game_manager.is_awaiting_hand_card():
			_show_targeting_banner("🃏 Válassz kártyát a kezedből! [Jobb klikk: Kihagyás]")
		elif game_manager.is_awaiting_discard_from_hand():
			_show_targeting_banner("🗑 Válassz lapot az eldobáshoz!")
		elif game_manager.is_awaiting_ring_target():
			_show_targeting_banner("💍 Válassz egységet a gyűrűhöz! [Jobb klikk: Mégse]")
	else:
		end_turn_button.disabled = not game_manager.is_player_turn()
		_dismiss_targeting_banner()

## ===========================
## VICTORY / DEFEAT POPUP
## ===========================

func _check_victory() -> void:
	if not game_manager:
		return
	if game_manager.enemy_hp <= 0:
		if get_node_or_null("VictoryOverlay"):
			return
		_show_victory_popup()
	elif game_manager.player_hp <= 0:
		if get_node_or_null("DefeatOverlay"):
			return
		_show_defeat_popup()

func _show_victory_popup() -> void:
	var overlay := Control.new()
	overlay.name = "VictoryOverlay"
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP

	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = Color(0, 0, 0, 0.65)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)

	var panel := PanelContainer.new()
	var ps := StyleBoxFlat.new()
	ps.bg_color = Color(0.08, 0.1, 0.14)
	ps.border_color = Color(0.831, 0.659, 0.263)
	ps.set_border_width_all(3)
	ps.set_corner_radius_all(12)
	ps.set_content_margin_all(30)
	panel.add_theme_stylebox_override("panel", ps)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 16)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "GYŐZELEM!"
	title.add_theme_color_override("font_color", Color(0.831, 0.659, 0.263))
	title.add_theme_font_size_override("font_size", 32)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "Az ellenfél életpontjai elfogytak!"
	subtitle.add_theme_color_override("font_color", Color(0.7, 0.73, 0.76))
	subtitle.add_theme_font_size_override("font_size", 14)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(subtitle)

	add_child(overlay)

func _show_defeat_popup() -> void:
	var overlay := Control.new()
	overlay.name = "DefeatOverlay"
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP

	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = Color(0, 0, 0, 0.65)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)

	var panel := PanelContainer.new()
	var ps := StyleBoxFlat.new()
	ps.bg_color = Color(0.08, 0.1, 0.14)
	ps.border_color = Color(0.8, 0.2, 0.2)
	ps.set_border_width_all(3)
	ps.set_corner_radius_all(12)
	ps.set_content_margin_all(30)
	panel.add_theme_stylebox_override("panel", ps)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 16)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "VERESÉG"
	title.add_theme_color_override("font_color", Color(0.8, 0.2, 0.2))
	title.add_theme_font_size_override("font_size", 32)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "Az ellenfeled győzött!"
	subtitle.add_theme_color_override("font_color", Color(0.7, 0.73, 0.76))
	subtitle.add_theme_font_size_override("font_size", 14)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(subtitle)

	add_child(overlay)

func _on_game_won() -> void:
	_show_victory_popup()

func _on_game_lost() -> void:
	_show_defeat_popup()

## ===========================
## SIGNAL HANDLERS
## ===========================

func _on_unit_damaged(_unit, _amount: int) -> void:
	_refresh_grid()

func _on_unit_died(_unit) -> void:
	_refresh_grid()
	_refresh_hand()
	_update_counts()

func _on_card_played(_card, _row: int, _col: int) -> void:
	_refresh_grid()
	_refresh_hand()
	_update_counts()

func _on_choose_one_requested(choices: Array, callback: Callable) -> void:
	_add_log("⚡ Válassz:")
	for i in range(choices.size()):
		var ab = choices[i]
		if ab:
			var label_text: String = ab if ab is String else (ab.description if ab.get("description") else str(ab))
			_add_log("  [%d] %s" % [i + 1, label_text])

	_dismiss_choice_panel()

	_choice_panel = Control.new()
	_choice_panel.name = "ChoiceOverlay"
	_choice_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_choice_panel.mouse_filter = Control.MOUSE_FILTER_STOP

	var overlay_bg := ColorRect.new()
	overlay_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay_bg.color = Color(0, 0, 0, 0.5)
	overlay_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_choice_panel.add_child(overlay_bg)

	_choice_panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed:
			if event.button_index == MOUSE_BUTTON_RIGHT:
				_cancel_all()
	)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_choice_panel.add_child(center)

	var panel := PanelContainer.new()
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.1, 0.12, 0.16)
	panel_style.border_color = Color(0.831, 0.659, 0.263)
	panel_style.set_border_width_all(2)
	panel_style.set_corner_radius_all(8)
	panel_style.set_content_margin_all(20)
	panel.add_theme_stylebox_override("panel", panel_style)
	panel.custom_minimum_size = Vector2(340, 0)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "⚡ Válassz egyet!"
	title.add_theme_color_override("font_color", Color(0.831, 0.659, 0.263))
	title.add_theme_font_size_override("font_size", 18)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)
	vbox.add_child(HSeparator.new())

	for i in range(choices.size()):
		var ab = choices[i]
		if not ab:
			continue
		var btn := Button.new()
		var label_text: String = ab if ab is String else (ab.description if ab.get("description") else str(ab))
		btn.text = label_text
		btn.custom_minimum_size = Vector2(300, 44)
		var bstyle := StyleBoxFlat.new()
		bstyle.bg_color = Color(0.15, 0.18, 0.25)
		bstyle.border_color = Color(0.345, 0.651, 1.0)
		bstyle.set_border_width_all(1)
		bstyle.set_corner_radius_all(4)
		bstyle.set_content_margin_all(8)
		btn.add_theme_stylebox_override("normal", bstyle)
		var bhover := bstyle.duplicate()
		bhover.bg_color = Color(0.2, 0.25, 0.35)
		bhover.set_border_width_all(2)
		btn.add_theme_stylebox_override("hover", bhover)
		btn.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
		btn.add_theme_font_size_override("font_size", 14)
		var choice_idx := i
		btn.pressed.connect(func() -> void:
			callback.call(choice_idx)
			_dismiss_choice_panel()
			_dismiss_targeting_banner()
			selected_hand_index = -1
			_refresh_hand()
			_refresh_grid()
			_update_counts()
			_check_victory()
			_update_interactive_ui()
		)
		vbox.add_child(btn)

	vbox.add_child(HSeparator.new())
	var hint := Label.new()
	hint.text = "[Jobb klikk: Mégse]"
	hint.add_theme_color_override("font_color", Color(0.431, 0.463, 0.502))
	hint.add_theme_font_size_override("font_size", 11)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(hint)

	add_child(_choice_panel)
	_update_interactive_ui()

func _on_target_requested(_valid_target: String, range_val: int,
		_source_row: int, _source_col: int, _callback: Callable) -> void:
	if _valid_target == AbilityScript.ValidTarget1.UNIT and game_manager._target_valid_3 == "cost<SELF":
		_show_command_target_popup()
	else:
		_dismiss_command_target_popup()
	var valid_tiles: Array = game_manager.get_current_valid_target_tiles()
	var has_valid: bool = valid_tiles.size() > 0
	var enemy_player_valid: bool = game_manager.can_target_enemy_player(_valid_target, game_manager._target_valid_2, range_val)
	for row in range(GRID_ROWS):
		for col in range(GRID_COLS):
			var pos := Vector2i(row, col)
			var is_valid := false
			for vt in valid_tiles:
				if vt == pos:
					is_valid = true
					break
			grid_cells[row][col].set_target_highlight(is_valid)
	if not has_valid and not enemy_player_valid:
		_add_log("Nincs célpont hatótávon belül!")
		_cancel_all()
		return
	# Show targeting UI lockdown
	_update_interactive_ui()

func _show_command_target_popup() -> void:
	_dismiss_command_target_popup()
	if not game_log_panel:
		return
	_command_target_popup = Control.new()
	_command_target_popup.name = "CommandTargetOverlay"
	_command_target_popup.set_anchors_preset(Control.PRESET_FULL_RECT)
	_command_target_popup.mouse_filter = Control.MOUSE_FILTER_IGNORE
	game_log_panel.add_child(_command_target_popup)

	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = Color(0, 0, 0, 0.65)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_command_target_popup.add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_command_target_popup.add_child(center)

	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.12, 0.16)
	style.border_color = Color(0.831, 0.659, 0.263)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(12)
	panel.add_theme_stylebox_override("panel", style)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 6)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "⚔ Bodur Parancs"
	title.add_theme_font_size_override("font_size", 16)
	title.add_theme_color_override("font_color", Color(0.831, 0.659, 0.263))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var msg := Label.new()
	msg.text = "Válassz szövetséges egységet a kijelölt mezők közül!"
	msg.add_theme_font_size_override("font_size", 12)
	msg.add_theme_color_override("font_color", Color(0.88, 0.9, 0.93))
	msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	vbox.add_child(msg)

func _dismiss_command_target_popup() -> void:
	if _command_target_popup:
		_command_target_popup.queue_free()
		_command_target_popup = null
	if command_hint_panel:
		command_hint_panel.visible = false

## ===========================
## GAME LOG
## ===========================

func _add_log(message: String) -> void:
	log_lines.append(message)
	if log_lines.size() > 50:
		log_lines.pop_front()
	if game_log_view:
		game_log_view.append_text(_format_log_line(message) + "\n")
		game_log_view.scroll_to_line(maxi(0, game_log_view.get_line_count() - 1))
	print("[Skart] %s" % message)

func _format_log_line(message: String) -> String:
	var escaped := message.replace("[", "\\[").replace("]", "\\]")
	var names: Array = _known_cards_by_name.keys()
	names.sort_custom(func(a, b): return str(a).length() > str(b).length())
	for card_n in names:
		var card_name := str(card_n)
		if card_name == "":
			continue
		escaped = escaped.replace(card_name, "[url=card:%s]%s[/url]" % [card_name, card_name])
	return escaped

func _on_log_meta_clicked(meta: Variant) -> void:
	var text := str(meta)
	if not text.begins_with("card:"):
		return
	var card_name := text.substr(5)
	if _known_cards_by_name.has(card_name):
		_show_card_preview(_known_cards_by_name[card_name])

func _on_log_meta_hover_started(meta: Variant) -> void:
	var text := str(meta)
	if not text.begins_with("card:"):
		return
	var card_name := text.substr(5)
	if _known_cards_by_name.has(card_name):
		_show_card_preview(_known_cards_by_name[card_name])

func _rebuild_known_cards_cache() -> void:
	_known_cards_by_name.clear()
	if not game_manager:
		return
	for card in game_manager.player_hand:
		if card:
			_known_cards_by_name[card.card_name] = card
	for card in game_manager.player_discard:
		if card:
			_known_cards_by_name[card.card_name] = card
	for card in game_manager.player_pile:
		if card:
			_known_cards_by_name[card.card_name] = card
	for character in game_manager.player_characters:
		if character:
			_known_cards_by_name[character.card_name] = character
	for character in game_manager.enemy_characters:
		if character:
			_known_cards_by_name[character.card_name] = character
	for row in range(GRID_ROWS):
		for col in range(GRID_COLS):
			var u = game_manager.get_unit_at(row, col)
			if u and u.card:
				_known_cards_by_name[u.card.card_name] = u.card
	for cid in game_manager.enemy_discard_ids:
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			_known_cards_by_name[card.card_name] = card
	for cid in game_manager.enemy_pile_ids:
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			_known_cards_by_name[card.card_name] = card

## ===========================
## GAME MANAGER BRIDGE — unified command dispatch
## ===========================

func _create_game_manager() -> void:
	if game_manager:
		game_manager.queue_free()
	game_manager = GameManagerScript.new()
	add_child(game_manager)
	game_manager.hand_updated.connect(_refresh_hand)
	game_manager.game_log.connect(_add_log)
	game_manager.unit_damaged.connect(_on_unit_damaged)
	game_manager.unit_died.connect(_on_unit_died)
	game_manager.card_played.connect(_on_card_played)
	game_manager.choose_one_requested.connect(_on_choose_one_requested)
	game_manager.target_requested.connect(_on_target_requested)
	game_manager.steal_from_hand_requested.connect(_on_steal_from_hand_requested)
	game_manager.ring_target_requested.connect(_on_ring_target_requested)
	game_manager.hand_card_target_requested.connect(_on_hand_card_target_requested)
	game_manager.discard_from_hand_requested.connect(_on_discard_from_hand_requested)
	game_manager.search_pick_requested.connect(_on_search_pick_requested)
	game_manager.game_won.connect(_on_game_won)
	game_manager.game_lost.connect(_on_game_lost)
	game_manager.state_changed.connect(_on_game_state_changed)
	game_manager.end_turn_state_ready.connect(_on_end_turn_state_ready)
	game_manager.dev_mode = dev_mode
	if dev_mode:
		var DevCtxMenu = load("res://scripts/arena/dev_context_menu.gd")
		_dev_menu = DevCtxMenu.new(self, game_manager)

func _on_game_state_changed(snapshot: Dictionary) -> void:
	arena_state = snapshot
	if _mp_mode and game_manager and _mp_game_initialized and (game_manager.is_player_turn() or game_manager.dev_mode):
		_mp_send_state_to_server()

func _on_end_turn_state_ready() -> void:
	## Called after ON_TURN_END abilities complete — safe to send final state.
	if _mp_mode:
		_mp_end_turn_pending = true
		_mp_send_state_to_server()

func _sync_arena_state_from_manager() -> void:
	if not game_manager:
		return
	if game_manager.has_method("get_state_snapshot"):
		arena_state = game_manager.get_state_snapshot()

func _dispatch_gm_action(action: String, payload: Dictionary = {}) -> Dictionary:
	if not game_manager or not game_manager.has_method("issue_action"):
		return {"ok": false, "error": "A játékvezérlő nem elérhető."}
	var result: Dictionary = game_manager.issue_action(action, payload)
	if not bool(result.get("ok", false)):
		_add_log(str(result.get("error", "Sikertelen akció.")))
		return result
	# Multiplayer state sync: regular actions are sent via _on_game_state_changed.
	# END_TURN state is sent via end_turn_state_ready signal (after abilities complete).
	_sync_arena_state_from_manager()
	return result

## ===========================
## INPUT — right-click cancels everything
## ===========================

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
		if _dev_menu and not _is_in_interactive_state():
			# Dev mode: right-click on info bar elements
			var mpos: Vector2 = event.position
			var target_ctx := _dev_detect_info_context(mpos)
			if str(target_ctx.get("target", "")) != "":
				_dev_menu.show_context_menu(str(target_ctx.get("target", "")), target_ctx.get("context", {}), mpos)
				get_viewport().set_input_as_handled()
				return
		_cancel_all()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("ui_cancel"):
		_cancel_all()

func _on_cell_right_clicked(row: int, col: int) -> void:
	if not _dev_menu or _is_in_interactive_state():
		_cancel_all()
		return
	var unit = game_manager.get_unit_at(row, col) if game_manager else null
	var mpos: Vector2 = get_viewport().get_mouse_position()
	if unit:
		_dev_menu.show_context_menu("unit", {"row": row, "col": col}, mpos)
	else:
		_dev_menu.show_context_menu("empty_cell", {"row": row, "col": col}, mpos)

func _is_in_interactive_state() -> bool:
	if not game_manager:
		return false
	return game_manager.is_awaiting_choice() or game_manager.is_awaiting_target() \
		or game_manager.is_awaiting_ring_target() or game_manager.is_awaiting_hand_card()

func _dev_detect_info_context(mpos: Vector2) -> Dictionary:
	## Check if mouse is over an info bar element and return target+context.
	if player_hp_label and player_hp_label.get_global_rect().has_point(mpos):
		return {"target": "player_hp", "context": {}}
	if player_mana_label and player_mana_label.get_global_rect().has_point(mpos):
		return {"target": "player_mana", "context": {}}
	if player_deck_count and player_deck_count.get_global_rect().has_point(mpos):
		return {"target": "player_deck", "context": {}}
	if player_discard_count and player_discard_count.get_global_rect().has_point(mpos):
		return {"target": "player_discard", "context": {}}
	if player_pile_count and player_pile_count.get_global_rect().has_point(mpos):
		return {"target": "player_pile", "context": {}}
	if opponent_hp_label and opponent_hp_label.get_global_rect().has_point(mpos):
		return {"target": "enemy_hp", "context": {}}
	if opponent_mana_label and opponent_mana_label.get_global_rect().has_point(mpos):
		return {"target": "enemy_mana", "context": {}}
	if enemy_deck_count and enemy_deck_count.get_global_rect().has_point(mpos):
		return {"target": "enemy_deck", "context": {}}
	if enemy_discard_count and enemy_discard_count.get_global_rect().has_point(mpos):
		return {"target": "enemy_discard", "context": {}}
	if enemy_pile_count and enemy_pile_count.get_global_rect().has_point(mpos):
		return {"target": "enemy_pile", "context": {}}
	# Character slots
	if player_chars and player_chars.get_global_rect().has_point(mpos):
		var slot := _detect_char_slot(player_chars, mpos)
		if slot >= 0:
			return {"target": "player_character", "context": {"slot": slot}}
	if opponent_chars and opponent_chars.get_global_rect().has_point(mpos):
		var slot := _detect_char_slot(opponent_chars, mpos)
		if slot >= 0:
			return {"target": "enemy_character", "context": {"slot": slot}}
	return {"target": "", "context": {}}

func _detect_char_slot(container: HBoxContainer, mpos: Vector2) -> int:
	for i in range(container.get_child_count()):
		var child := container.get_child(i)
		if child.get_global_rect().has_point(mpos):
			return i
	return -1

func _setup_dev_right_click_hooks() -> void:
	## Some labels consume mouse input before _unhandled_input, so bind explicit right-click handlers.
	_bind_dev_right_click(player_hp_label, "player_hp", {})
	_bind_dev_right_click(player_mana_label, "player_mana", {})
	_bind_dev_right_click(player_deck_count, "player_deck", {})
	_bind_dev_right_click(player_discard_count, "player_discard", {})
	_bind_dev_right_click(player_pile_count, "player_pile", {})

	_bind_dev_right_click(opponent_hp_label, "enemy_hp", {})
	_bind_dev_right_click(opponent_mana_label, "enemy_mana", {})
	_bind_dev_right_click(enemy_deck_count, "enemy_deck", {})
	_bind_dev_right_click(enemy_discard_count, "enemy_discard", {})
	_bind_dev_right_click(enemy_pile_count, "enemy_pile", {})

	if player_hand:
		player_hand.mouse_filter = Control.MOUSE_FILTER_STOP
		player_hand.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
				if not _dev_menu or _is_in_interactive_state():
					return
				# Show hand menu only if click is not over an existing hand card.
				if _dev_is_over_hand_card(event.global_position):
					return
				_dev_menu.show_context_menu("player_hand", {}, event.global_position)
		)

func _bind_dev_right_click(node: Control, target: String, ctx: Dictionary) -> void:
	if not node:
		return
	node.mouse_filter = Control.MOUSE_FILTER_STOP
	node.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
			if _dev_menu and not _is_in_interactive_state():
				_dev_menu.show_context_menu(target, ctx, event.global_position)
	)

func _dev_is_over_hand_card(mpos: Vector2) -> bool:
	for item in _hand_items:
		if item is Control and (item as Control).get_global_rect().has_point(mpos):
			return true
	return false

func _end_turn() -> void:
	if not game_manager:
		return
	if not game_manager.is_player_turn():
		_add_log("Nem a te köröd!")
		return
	# Block end turn during interactive states
	if game_manager.is_interactive_state_active():
		_add_log("Célpont/választás kiválasztás folyamatban!")
		return
	_cancel_all()
	var end_turn_result := _dispatch_gm_action("END_TURN")
	if bool(end_turn_result.get("ok", false)):
		_refresh_grid()
		_refresh_hand()
		_update_counts()

func _dismiss_choice_panel() -> void:
	if _choice_panel:
		_choice_panel.queue_free()
		_choice_panel = null

func _dismiss_steal_panel() -> void:
	if _steal_panel:
		_steal_panel.queue_free()
		_steal_panel = null

## --- Steal from hand UI (Újraelosztás / Rablás) ---
func _on_steal_from_hand_requested(enemy_hand_cards: Array, callback: Callable) -> void:
	_dismiss_steal_panel()
	var count: int = enemy_hand_cards.size()

	_steal_panel = Control.new()
	_steal_panel.name = "StealOverlay"
	_steal_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_steal_panel.mouse_filter = Control.MOUSE_FILTER_STOP

	var overlay_bg := ColorRect.new()
	overlay_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay_bg.color = Color(0, 0, 0, 0.55)
	overlay_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_steal_panel.add_child(overlay_bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_steal_panel.add_child(center)

	var panel := PanelContainer.new()
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.1, 0.12, 0.16)
	panel_style.border_color = Color(0.85, 0.25, 0.25)
	panel_style.set_border_width_all(2)
	panel_style.set_corner_radius_all(8)
	panel_style.set_content_margin_all(20)
	panel.add_theme_stylebox_override("panel", panel_style)
	panel.custom_minimum_size = Vector2(380, 0)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 12)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "🃏 Rablás! Válassz egy lapot!"
	title.add_theme_color_override("font_color", Color(0.85, 0.25, 0.25))
	title.add_theme_font_size_override("font_size", 18)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "Az ellenfélnek %d lapja van. Válassz egy konkrét lapot!" % count
	subtitle.add_theme_color_override("font_color", Color(0.6, 0.62, 0.66))
	subtitle.add_theme_font_size_override("font_size", 13)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(subtitle)

	vbox.add_child(HSeparator.new())

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 8)
	hbox.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(hbox)

	for i in range(count):
		var card_back := Button.new()
		card_back.custom_minimum_size = Vector2(120, 90)
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.15, 0.08, 0.08)
		s.border_color = Color(0.6, 0.2, 0.2)
		s.set_border_width_all(2)
		s.set_corner_radius_all(4)
		s.set_content_margin_all(4)
		card_back.add_theme_stylebox_override("normal", s)
		var s_hover := s.duplicate()
		s_hover.bg_color = Color(0.25, 0.12, 0.12)
		s_hover.border_color = Color(0.9, 0.3, 0.3)
		s_hover.set_border_width_all(3)
		card_back.add_theme_stylebox_override("hover", s_hover)
		var shown = enemy_hand_cards[i]
		if shown and shown.get("card_name"):
			var shown_cost: int = shown.cost if shown.get("cost") != null else 0
			card_back.text = "%s\n(%d)" % [shown.card_name, shown_cost]
		else:
			card_back.text = "Ismeretlen"
		card_back.add_theme_font_size_override("font_size", 14)
		card_back.add_theme_color_override("font_color", Color(0.9, 0.8, 0.8))
		var idx := i
		card_back.pressed.connect(func() -> void:
			_dismiss_steal_panel()
			callback.call(idx)
			_refresh_hand()
			_refresh_grid()
			_refresh_enemy_hand()
			_update_counts()
		)
		hbox.add_child(card_back)

	add_child(_steal_panel)

## --- Hand card target selection (Mozgósítás) ---
func _on_hand_card_target_requested(_valid_indices: Array, _callback: Callable) -> void:
	## Refresh hand to show only valid cards as clickable, disable others.
	_refresh_hand()
	_add_log("🃏 Válassz egy egységet a kezedből! [Jobb klikk: Kihagyás]")
	_update_interactive_ui()

## --- Discard from hand selection (Lomtalanítás, Bolyongó) ---
func _on_discard_from_hand_requested(_valid_indices: Array, _to_exile: bool, _callback: Callable) -> void:
	## Refresh hand — all cards become "discard targets" (clickable).
	## The GM already set _awaiting_discard_from_hand and _discard_hand_callback.
	_refresh_hand()
	if _to_exile:
		_add_log("⚫ Válassz egy lapot a száműzéshez! [Kattints a lapra]")
	else:
		_add_log("🗑 Válassz egy lapot az eldobáshoz! [Kattints a lapra]")
	_update_interactive_ui()

## --- Deck search selection (Ryan Cooper) ---
func _on_search_pick_requested(shown_cards: Array, select_count: int, prompt: String, callback: Callable) -> void:
	_show_search_pick_panel(shown_cards, select_count, prompt, callback)

func _show_search_pick_panel(cards: Array, select_count: int, prompt: String, callback: Callable) -> void:
	## Show a popup with search result cards for the player to pick from.
	if cards.is_empty():
		callback.call([])
		return

	# Dismiss any existing search panel
	var old := get_node_or_null("DeckSearchOverlay")
	if old:
		old.queue_free()

	# Full-screen overlay (blocks all other input)
	var overlay := Control.new()
	overlay.name = "DeckSearchOverlay"
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP

	var overlay_bg := ColorRect.new()
	overlay_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay_bg.color = Color(0, 0, 0, 0.6)
	overlay_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(overlay_bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)

	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.08, 0.08, 0.15, 0.95)
	style.border_color = Color(0.6, 0.4, 1.0, 1.0)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(16)
	panel.add_theme_stylebox_override("panel", style)
	panel.custom_minimum_size = Vector2(400, 0)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	panel.add_child(vbox)

	var title_lbl := Label.new()
	title_lbl.text = "🔍 %s" % prompt
	title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_lbl.add_theme_font_size_override("font_size", 18)
	title_lbl.add_theme_color_override("font_color", Color(0.6, 0.4, 1.0))
	vbox.add_child(title_lbl)
	vbox.add_child(HSeparator.new())

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 8)
	hbox.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(hbox)

	if select_count == 1:
		# Single-select mode: click a card to pick it
		var seen_ids: Dictionary = {}
		for card in cards:
			var cid: int = int(card.card_id)
			if seen_ids.has(cid):
				continue
			seen_ids[cid] = true
			var btn := Button.new()
			btn.text = "%s (%d)" % [card.card_name, card.cost]
			btn.custom_minimum_size = Vector2(140, 44)
			var bstyle := StyleBoxFlat.new()
			bstyle.bg_color = Color(0.12, 0.1, 0.2)
			bstyle.border_color = Color(0.5, 0.35, 0.85)
			bstyle.set_border_width_all(1)
			bstyle.set_corner_radius_all(4)
			bstyle.set_content_margin_all(8)
			btn.add_theme_stylebox_override("normal", bstyle)
			var bhover := bstyle.duplicate()
			bhover.bg_color = Color(0.2, 0.15, 0.35)
			bhover.set_border_width_all(2)
			btn.add_theme_stylebox_override("hover", bhover)
			btn.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
			btn.add_theme_font_size_override("font_size", 14)
			var card_ref = card
			var overlay_ref = overlay
			var cb_ref = callback
			btn.pressed.connect(func():
				cb_ref.call([card_ref])
				overlay_ref.queue_free()
				_dismiss_targeting_banner()
				_refresh_hand()
				_refresh_grid()
				_update_counts()
				_update_interactive_ui()
			)
			hbox.add_child(btn)
	else:
		# Multi-select mode: toggle cards, then confirm
		var flexible: bool = (select_count <= 0)  # "any" mode: no fixed count
		var selected: Array = []
		var confirm_btn := Button.new()
		confirm_btn.text = "Kiválasztás (0)" if flexible else ("Kiválasztás (0/%d)" % select_count)
		confirm_btn.disabled = not flexible  # In flexible mode, allow confirming 0
		confirm_btn.custom_minimum_size = Vector2(200, 44)
		var cstyle := StyleBoxFlat.new()
		cstyle.bg_color = Color(0.15, 0.35, 0.15)
		cstyle.border_color = Color(0.3, 0.7, 0.3)
		cstyle.set_border_width_all(2)
		cstyle.set_corner_radius_all(4)
		cstyle.set_content_margin_all(8)
		confirm_btn.add_theme_stylebox_override("normal", cstyle)
		confirm_btn.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
		confirm_btn.add_theme_font_size_override("font_size", 16)

		var seen_ids: Dictionary = {}
		for card in cards:
			var cid: int = int(card.card_id)
			if seen_ids.has(cid):
				continue
			seen_ids[cid] = true
			var btn := Button.new()
			btn.text = "%s (%d)" % [card.card_name, card.cost]
			btn.custom_minimum_size = Vector2(140, 44)
			var off_style := StyleBoxFlat.new()
			off_style.bg_color = Color(0.12, 0.1, 0.2)
			off_style.border_color = Color(0.5, 0.35, 0.85)
			off_style.set_border_width_all(1)
			off_style.set_corner_radius_all(4)
			off_style.set_content_margin_all(8)
			var on_style := StyleBoxFlat.new()
			on_style.bg_color = Color(0.2, 0.3, 0.15)
			on_style.border_color = Color(0.4, 0.8, 0.3)
			on_style.set_border_width_all(2)
			on_style.set_corner_radius_all(4)
			on_style.set_content_margin_all(8)
			btn.add_theme_stylebox_override("normal", off_style)
			btn.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
			btn.add_theme_font_size_override("font_size", 14)
			var card_ref = card
			var btn_ref = btn
			var off_ref = off_style
			var on_ref = on_style
			var sel_ref = selected
			var sc_ref = select_count
			var flex_ref = flexible
			var confirm_ref = confirm_btn
			btn.pressed.connect(func():
				var idx = sel_ref.find(card_ref)
				if idx >= 0:
					sel_ref.remove_at(idx)
					btn_ref.add_theme_stylebox_override("normal", off_ref)
				else:
					if flex_ref or sel_ref.size() < sc_ref:
						sel_ref.append(card_ref)
						btn_ref.add_theme_stylebox_override("normal", on_ref)
				if flex_ref:
					confirm_ref.text = "Kiválasztás (%d)" % sel_ref.size()
				else:
					confirm_ref.text = "Kiválasztás (%d/%d)" % [sel_ref.size(), sc_ref]
					confirm_ref.disabled = sel_ref.size() != sc_ref
			)
			hbox.add_child(btn)

		var overlay_ref = overlay
		var cb_ref = callback
		var sel_confirm_ref = selected
		confirm_btn.pressed.connect(func():
			cb_ref.call(sel_confirm_ref.duplicate())
			overlay_ref.queue_free()
			_dismiss_targeting_banner()
			_refresh_hand()
			_refresh_grid()
			_update_counts()
			_update_interactive_ui()
		)
		vbox.add_child(confirm_btn)

	add_child(overlay)

## --- Ring target selection UI ---
func _on_ring_target_requested(_callback: Callable) -> void:
	## Highlight allied units for ring placement.
	var valid_tiles: Array = game_manager.get_ring_valid_tiles()
	for tile in valid_tiles:
		grid_cells[tile.x][tile.y].set_target_highlight(true)
	_add_log("💍 Kattints egy szövetséges egységre a gyűrű felrakásához! [Jobb klikk: Mégse]")
	_update_interactive_ui()

func _clear_target_highlights() -> void:
	_dismiss_command_target_popup()
	for row in range(GRID_ROWS):
		for col in range(GRID_COLS):
			grid_cells[row][col].set_target_highlight(false)

## ===========================
## UNIT ACTION POPUP — Move, Attack, Attack Player
## ===========================

func _show_unit_action_popup(row: int, col: int) -> void:
	var unit = game_manager.get_unit_at(row, col)
	if not unit or unit.owner_id != 0:
		return
	_show_unit_preview(unit)

	var move_targets: Array = game_manager.get_valid_move_targets(row, col)
	var attack_targets: Array = game_manager.get_valid_attack_targets(row, col)
	var can_atk_player: bool = game_manager.can_attack_player(row, col)
	var can_move: bool = move_targets.size() > 0
	var can_attack: bool = attack_targets.size() > 0 or can_atk_player

	if not can_move and not can_attack:
		_add_log("%s nem tud cselekedni ebben a körben." % unit.get_display_name())
		return

	# Only move available — auto start move
	if can_move and not can_attack:
		_start_unit_move(row, col)
		return

	# Show action popup next to the cell
	_dismiss_action_popup()
	_selected_unit_row = row
	_selected_unit_col = col

	_action_popup = PanelContainer.new()
	var popup_style := StyleBoxFlat.new()
	popup_style.bg_color = Color(0.1, 0.12, 0.16)
	popup_style.border_color = Color(0.345, 0.651, 1.0)
	popup_style.set_border_width_all(2)
	popup_style.set_corner_radius_all(6)
	popup_style.set_content_margin_all(6)
	_action_popup.add_theme_stylebox_override("panel", popup_style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 4)
	_action_popup.add_child(vbox)

	if can_move:
		var move_btn := Button.new()
		move_btn.text = "🏃 Mozgás"
		move_btn.custom_minimum_size = Vector2(100, 28)
		_style_action_button(move_btn)
		var r := row
		var c := col
		move_btn.pressed.connect(func() -> void:
			_dismiss_action_popup()
			_start_unit_move(r, c)
		)
		vbox.add_child(move_btn)

	if can_attack:
		var atk_btn := Button.new()
		atk_btn.text = "⚔ Támadás"
		atk_btn.custom_minimum_size = Vector2(100, 28)
		_style_action_button(atk_btn)
		var r := row
		var c := col
		atk_btn.pressed.connect(func() -> void:
			_dismiss_action_popup()
			_start_unit_attack(r, c)
		)
		vbox.add_child(atk_btn)

	add_child(_action_popup)
	var cell: GridCell = grid_cells[row][col]
	var cell_pos := cell.global_position
	var cell_sz := cell.size
	_action_popup.position = cell_pos + Vector2(cell_sz.x + 4, 0)
	_adjust_popup_position.call_deferred()

func _adjust_popup_position() -> void:
	if not _action_popup:
		return
	var popup_sz := _action_popup.size
	if _action_popup.position.x + popup_sz.x > size.x:
		var cell: GridCell = grid_cells[_selected_unit_row][_selected_unit_col]
		_action_popup.position.x = cell.global_position.x - popup_sz.x - 4
	if _action_popup.position.y + popup_sz.y > size.y:
		_action_popup.position.y = size.y - popup_sz.y

func _style_action_button(btn: Button) -> void:
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.15, 0.18, 0.25)
	s.border_color = Color(0.3, 0.35, 0.45)
	s.set_border_width_all(1)
	s.set_corner_radius_all(3)
	s.set_content_margin_all(4)
	btn.add_theme_stylebox_override("normal", s)
	var h := s.duplicate()
	h.bg_color = Color(0.2, 0.25, 0.35)
	h.border_color = Color(0.345, 0.651, 1.0)
	btn.add_theme_stylebox_override("hover", h)
	btn.add_theme_color_override("font_color", Color(0.9, 0.93, 0.96))
	btn.add_theme_font_size_override("font_size", 11)

func _start_unit_move(row: int, col: int) -> void:
	_selected_unit_row = row
	_selected_unit_col = col
	_unit_action_state = 1
	var targets: Array = game_manager.get_valid_move_targets(row, col)
	for pos in targets:
		grid_cells[pos.x][pos.y].set_target_highlight(true)
	var unit = game_manager.get_unit_at(row, col)
	_add_log("Válassz célmezőt %s mozgatásához!" % unit.get_display_name())

func _start_unit_attack(row: int, col: int) -> void:
	_selected_unit_row = row
	_selected_unit_col = col
	_unit_action_state = 2
	var targets: Array = game_manager.get_valid_attack_targets(row, col)
	var can_atk_player: bool = game_manager.can_attack_player(row, col)
	var total_targets: int = targets.size() + (1 if can_atk_player else 0)
	if total_targets == 1:
		if can_atk_player and targets.is_empty():
			var attack_player_result := _dispatch_gm_action("ATTACK_PLAYER", {"row": row, "col": col})
			if bool(attack_player_result.get("ok", false)):
				_cancel_unit_action()
				_refresh_grid()
				_update_counts()
				_check_victory()
			return
		var only_target: Vector2i = targets[0]
		var attack_unit_result := _dispatch_gm_action("ATTACK_UNIT", {
			"atk_row": row,
			"atk_col": col,
			"def_row": only_target.x,
			"def_col": only_target.y,
		})
		if bool(attack_unit_result.get("ok", false)):
			_cancel_unit_action()
			_refresh_grid()
			_update_counts()
			_check_victory()
		return
	for pos in targets:
		grid_cells[pos.x][pos.y].set_target_highlight(true)
	var unit = game_manager.get_unit_at(row, col)
	if can_atk_player:
		_add_log("Válassz célpontot %s támadásához! (Egység vagy ellenfél HP)" % unit.get_display_name())
	else:
		_add_log("Válassz ellenséget %s támadásához!" % unit.get_display_name())

func _dismiss_action_popup() -> void:
	if _action_popup:
		_action_popup.queue_free()
		_action_popup = null

func _cancel_unit_action() -> void:
	_unit_action_state = 0
	_selected_unit_row = -1
	_selected_unit_col = -1
	_clear_target_highlights()
	_dismiss_action_popup()

## ===========================
## HAND/BENCH TOGGLE
## ===========================

func _toggle_player_hand_bench() -> void:
	_player_showing_bench = not _player_showing_bench
	player_hand_switch.text = "KÉZ" if _player_showing_bench else "PAD"
	_refresh_hand()

func _toggle_enemy_hand_bench() -> void:
	_enemy_showing_bench = not _enemy_showing_bench
	enemy_hand_switch.text = "KÉZ" if _enemy_showing_bench else "PAD"
	_refresh_enemy_hand()

func _refresh_enemy_hand() -> void:
	for child in enemy_hand.get_children():
		child.queue_free()
	if not game_manager:
		return

	if _enemy_showing_bench:
		for cid in game_manager.enemy_discard_ids:
			var card = CardDatabaseScript.get_card(int(cid))
			if card:
				enemy_hand.add_child(_create_bench_card(card, "Temető", _icon_graveyard))
		for cid in game_manager.enemy_pile_ids:
			var card = CardDatabaseScript.get_card(int(cid))
			if card:
				enemy_hand.add_child(_create_bench_card(card, "Rakás", _icon_rakas))
		if game_manager.enemy_discard_ids.is_empty() and game_manager.enemy_pile_ids.is_empty():
			var placeholder := Label.new()
			placeholder.text = "Pad üres"
			placeholder.add_theme_font_size_override("font_size", 14)
			placeholder.add_theme_color_override("font_color", Color(0.35, 0.37, 0.42))
			placeholder.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			placeholder.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			placeholder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			placeholder.size_flags_vertical = Control.SIZE_EXPAND_FILL
			enemy_hand.add_child(placeholder)
		return

	for i in range(game_manager.enemy_hand_count):
		var card_back := PanelContainer.new()
		var back_size: int = maxi(_cell_size - 14, 50)
		card_back.custom_minimum_size = Vector2(back_size, back_size)
		card_back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.12, 0.14, 0.18)
		s.border_color = Color(0.3, 0.32, 0.36)
		s.set_border_width_all(1)
		s.set_corner_radius_all(3)
		s.set_content_margin_all(4)
		card_back.add_theme_stylebox_override("panel", s)
		var lbl := Label.new()
		lbl.text = "?"
		lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		lbl.add_theme_font_size_override("font_size", 16)
		lbl.add_theme_color_override("font_color", Color(0.4, 0.42, 0.46))
		card_back.add_child(lbl)
		enemy_hand.add_child(card_back)

func _setup_hand_bars() -> void:
	var ehs := StyleBoxFlat.new()
	ehs.bg_color = Color(0.06, 0.08, 0.11)
	ehs.border_color = Color(0.2, 0.22, 0.28)
	ehs.set_border_width_all(1)
	ehs.set_corner_radius_all(4)
	ehs.set_content_margin_all(6)
	$MainLayout/RightSection/EnemyHandBar.add_theme_stylebox_override("panel", ehs)
	var phs := ehs.duplicate()
	phs.border_color = Color(0.25, 0.3, 0.4)
	$MainLayout/RightSection/PlayerHandBar.add_theme_stylebox_override("panel", phs)
	for btn in [enemy_hand_switch, player_hand_switch]:
		var bs := StyleBoxFlat.new()
		bs.bg_color = Color(0.1, 0.12, 0.16)
		bs.border_color = Color(0.3, 0.33, 0.38)
		bs.set_border_width_all(1)
		bs.set_corner_radius_all(3)
		bs.set_content_margin_all(4)
		btn.add_theme_stylebox_override("normal", bs)
		var bh := bs.duplicate()
		bh.bg_color = Color(0.15, 0.18, 0.24)
		btn.add_theme_stylebox_override("hover", bh)
		btn.add_theme_color_override("font_color", Color(0.6, 0.63, 0.67))
		btn.add_theme_font_size_override("font_size", 10)
	for bar_path in ["EnemyInfoBar", "PlayerInfoBar"]:
		var bar := $MainLayout/RightSection.get_node(bar_path)
		var bg := Panel.new()
		bg.set_anchors_preset(Control.PRESET_FULL_RECT)
		bg.show_behind_parent = true
		var ss := StyleBoxFlat.new()
		ss.bg_color = Color(0.05, 0.065, 0.085)
		ss.border_color = Color(0.15, 0.17, 0.2)
		ss.set_border_width_all(1)
		ss.set_corner_radius_all(2)
		ss.set_content_margin_all(3)
		bg.add_theme_stylebox_override("panel", ss)
		bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bar.add_child(bg)
		bar.move_child(bg, 0)
	# Enemy player targeting — click on OpponentHPLabel
	opponent_hp_label.mouse_filter = Control.MOUSE_FILTER_STOP
	opponent_hp_label.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_on_enemy_player_clicked()
	)
	# Self player targeting — click on PlayerHPCount
	player_hp_label.mouse_filter = Control.MOUSE_FILTER_STOP
	player_hp_label.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_on_self_player_clicked()
	)

## ===========================
## MULTIPLAYER TRANSPORT — just HTTP polling + state sync
## Server is a dumb relay. game_manager.gd does ALL the logic.
## ===========================

var _mp_sync_pending: bool = false
var _mp_poll_pending: bool = false
var _mp_state_dirty: bool = false
var _mp_game_initialized: bool = false
var _mp_last_turn_number: int = -1
var _mp_last_turn_uid: int = 0
var _mp_last_state_hash: String = ""
var _mp_end_turn_pending: bool = false  ## True after we END_TURN until server confirms

func _mp_poll_game_state() -> void:
	if _mp_poll_pending or _mp_sync_pending:
		return
	if not _mp_http_poll:
		return
	_mp_poll_pending = true
	var url := "%s/api/lobbies/%s/game" % [_mp_base_url, _mp_lobby_id]
	var headers := ["Authorization: Bearer %s" % _mp_token, "Content-Type: application/json"]
	var err := _mp_http_poll.request(url, headers, HTTPClient.METHOD_GET)
	if err != OK:
		_add_log("HTTP poll hiba: %d" % err)
		_mp_poll_pending = false

func _on_mp_poll_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	_mp_poll_pending = false
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		if response_code == 404:
			_add_log("A játék még nem indult el...")
		else:
			print("[Skart] Poll hiba: result=%d, code=%d" % [result, response_code])
		return
	var raw_text := body.get_string_from_utf8()
	var json := JSON.new()
	var err := json.parse(raw_text)
	if err != OK:
		_add_log("JSON parse hiba!")
		print("[Skart] JSON parse hiba, raw=%s" % raw_text.left(200))
		return
	if not (json.data is Dictionary) or not json.data.has("game"):
		_add_log("Hiányzó 'game' a szerver válaszban!")
		print("[Skart] Szerver válasz kulcsok: %s" % str(json.data.keys() if json.data is Dictionary else "nem dict"))
		return

	var game_data: Dictionary = json.data["game"]

	# First time: initialize game_manager from setup data
	if not _mp_game_initialized:
		print("[Skart] Inicializálás, game_data kulcsok: %s" % str(game_data.keys()))
		_mp_initialize_game(game_data)
		return

	# Subsequent polls: check if opponent updated the state
	var server_state: Dictionary = game_data.get("gameState", {})
	if server_state.is_empty():
		return

	var server_turn: int = int(server_state.get("turn_number", -1))
	var server_turn_uid: int = int(server_state.get("current_turn_user_id", 0))

	# In normal mode, current turn owner is authority. In dev mode, accept remote edits always.
	if game_manager.is_player_turn() and not game_manager.dev_mode:
		return

	# After we END_TURN, the server may briefly still have our OLD state
	# (before END_TURN arrived). If the server says it's OUR turn but we
	# already ended ours, it's a stale echo — skip it. Once the server
	# shows it's the opponent's turn, our END_TURN was processed.
	if _mp_end_turn_pending:
		if server_turn_uid == _mp_user_id:
			# Stale echo — server hasn't received our END_TURN yet
			return
		else:
			# Server confirms opponent's turn — our END_TURN was processed
			_mp_end_turn_pending = false

	# It's opponent's turn — load every changed server state
	var state_hash: String = JSON.stringify(server_state)
	if state_hash == _mp_last_state_hash:
		return

	var before_grid: Array = game_manager.grid.duplicate(true)
	var before_my_hp: int = game_manager.player_hp
	var before_enemy_hp: int = game_manager.enemy_hp
	_mp_last_turn_number = server_turn
	_mp_last_turn_uid = server_turn_uid
	_mp_last_state_hash = state_hash
	game_manager.load_state_from_server(server_state)
	_log_remote_actions(before_grid, game_manager.grid, before_my_hp, game_manager.player_hp, before_enemy_hp, game_manager.enemy_hp)
	_refresh_grid()
	_refresh_hand()
	_update_counts()
	_check_victory()

func _log_remote_actions(before_grid: Array, after_grid: Array,
		before_my_hp: int, after_my_hp: int, _before_enemy_hp: int, _after_enemy_hp: int) -> void:
	var opp_name: String = opponent_name_label.text if opponent_name_label else "Ellenfél"
	var old_enemy: Dictionary = {}
	var new_enemy: Dictionary = {}
	for r in range(GRID_ROWS):
		for c in range(GRID_COLS):
			var old_u = before_grid[r][c]
			if old_u and old_u.owner_id == 1:
				old_enemy[Vector2i(r, c)] = old_u
			var new_u = after_grid[r][c]
			if new_u and new_u.owner_id == 1:
				new_enemy[Vector2i(r, c)] = new_u

	var old_only: Array = []
	var new_only: Array = []
	for pos in old_enemy.keys():
		if not new_enemy.has(pos):
			old_only.append(pos)
	for pos in new_enemy.keys():
		if not old_enemy.has(pos):
			new_only.append(pos)

	var used_old: Dictionary = {}
	for new_pos in new_only:
		var new_u = new_enemy[new_pos]
		var matched_old: Variant = null
		for old_pos in old_only:
			if used_old.has(old_pos):
				continue
			var old_u = old_enemy[old_pos]
			if old_u.card.card_id == new_u.card.card_id:
				matched_old = old_pos
				break
		if matched_old != null:
			used_old[matched_old] = true
			_add_log("%s mozog: %s (%s → %s)" % [opp_name, new_u.get_display_name(), _arena_cell_label(matched_old.x, matched_old.y), _arena_cell_label(new_pos.x, new_pos.y)])
		else:
			_add_log("%s kijátszotta %s lapot a(z) %s mezőre." % [opp_name, new_u.get_display_name(), _arena_cell_label(new_pos.x, new_pos.y)])

	for old_pos in old_only:
		if used_old.has(old_pos):
			continue
		var old_u = old_enemy[old_pos]
		_add_log("%s egysége elesett: %s (%s)" % [opp_name, old_u.get_display_name(), _arena_cell_label(old_pos.x, old_pos.y)])

	if after_my_hp < before_my_hp:
		_add_log("%s %d sebzést okozott neked." % [opp_name, before_my_hp - after_my_hp])

func _arena_cell_label(row: int, col: int) -> String:
	return "%s%d" % ["ABCDE"[col], row + 1]

func _mp_initialize_game(game_data: Dictionary) -> void:
	## First time setup: create game_manager, load decks, start game.
	## Supports two server formats:
	##   NEW: game_data has "setupData" wrapper with "players" array + "deckCardIds"
	##   OLD: game_data has "players" array at top level with "deck"+"hand" per player

	var players: Array = []
	var first_uid: int = 0

	# --- Detect format ---
	var setup: Dictionary = game_data.get("setupData", {})
	if not setup.is_empty() and setup.has("players"):
		# NEW format: setupData wrapper
		players = setup.get("players", [])
		first_uid = int(setup.get("firstPlayerUserId", 0))
		print("[Skart] Detected NEW setupData format")
	elif game_data.has("players") and game_data.get("players") is Array:
		# OLD flat format: players array at top level
		players = game_data.get("players", [])
		first_uid = int(game_data.get("firstPlayerUserId", 0))
		print("[Skart] Detected OLD flat format (players at top level)")
	else:
		_add_log("Hiányzó setupData! (Szerver újraindult? Próbáld újra a lobby-t.)")
		print("[Skart] game_data kulcsok: %s" % str(game_data.keys()))
		print("[Skart] game_data tartalom: %s" % str(game_data).left(500))
		return

	if players.size() < 2:
		_add_log("Nincs elég játékos az adatban! (%d)" % players.size())
		return

	var my_data: Dictionary = {}
	var opp_data: Dictionary = {}
	for p in players:
		var p_uid: int = int(p.get("userId", 0))
		if p_uid == _mp_user_id:
			my_data = p
		else:
			opp_data = p

	if my_data.is_empty() or opp_data.is_empty():
		_add_log("Saját (uid=%d) vagy ellenfél adat nem található!" % _mp_user_id)
		print("[Skart] players userIds: %s, my uid: %d" % [str(players.map(func(p): return p.get("userId", 0))), _mp_user_id])
		return

	var is_first := (_mp_user_id == first_uid)
	var my_char_ids: Array = my_data.get("characterIds", [])
	var opp_char_ids: Array = opp_data.get("characterIds", [])
	var my_name: String = str(my_data.get("username", "Te"))
	var opp_name: String = str(opp_data.get("username", "Ellenfél"))
	opponent_name_label.text = opp_name
	player_name_label.text = my_name

	# Deck card IDs: NEW format uses "deckCardIds", OLD format uses "deck" + "hand"
	var my_deck_ids: Array = my_data.get("deckCardIds", [])
	if my_deck_ids.is_empty():
		# OLD format: combine deck + hand (game_manager will re-deal)
		var deck_arr: Array = my_data.get("deck", [])
		var hand_arr: Array = my_data.get("hand", [])
		my_deck_ids = deck_arr + hand_arr
		# Also include discard/pile in case cards moved there already
		my_deck_ids += my_data.get("discard", [])
		my_deck_ids += my_data.get("pile", [])

	var opp_deck_ids: Array = opp_data.get("deckCardIds", [])
	if opp_deck_ids.is_empty():
		var opp_deck_arr: Array = opp_data.get("deck", [])
		var opp_hand_arr: Array = opp_data.get("hand", [])
		opp_deck_ids = opp_deck_arr + opp_hand_arr
		opp_deck_ids += opp_data.get("discard", [])
		opp_deck_ids += opp_data.get("pile", [])

	var my_side_deck_ids: Array = my_data.get("sidedeckIds", [])

	print("[Skart] MP init: first=%s, myChars=%s, myDeck=%d cards, oppChars=%s, oppDeck=%d cards" % [
		str(is_first), str(my_char_ids), my_deck_ids.size(), str(opp_char_ids), opp_deck_ids.size()])

	# Build character card arrays from card database
	var my_chars: Array = []
	for cid in my_char_ids:
		var card = CardDatabaseScript.get_card(int(cid))
		if card:
			my_chars.append(card)
		else:
			_add_log("FIGYELEM: Karakter %d nem található az adatbázisban!" % int(cid))

	if my_chars.size() == 0:
		_add_log("HIBA: Egyetlen karakter sem található! IDs: %s" % str(my_char_ids))
		return

	_create_game_manager()
	game_manager.setup_multiplayer_game(
		_mp_user_id, int(opp_data.get("userId", 0)),
		my_chars, my_deck_ids,
		opp_char_ids, opp_deck_ids,
		is_first, opp_name, my_side_deck_ids
	)

	_mp_game_initialized = true

	# Apply perspective: player 1 flips rows (base at bottom), player 2 flips cols
	if is_first:
		_perspective_flip_rows = true
		_perspective_flip_cols = false
	else:
		_perspective_flip_rows = false
	_perspective_flip_cols = true
	_apply_grid_perspective()

	_sync_arena_state_from_manager()
	_mp_last_turn_number = game_manager.turn_number
	_mp_last_turn_uid = _mp_user_id if game_manager.is_player_turn() else int(opp_data.get("userId", 0))
	_mp_last_state_hash = ""
	_refresh_grid()
	_refresh_hand()
	_update_counts()
	_add_log("Multiplayer játék inicializálva! %s: %s" % [
		"Első játékos" if is_first else "Második játékos", opp_name])

	# If I'm first player, send the initial state to server
	if is_first:
		_mp_send_state_to_server()
	else:
		# If player 1 already sent state, load it
		var existing_state: Dictionary = game_data.get("gameState", {})
		if not existing_state.is_empty():
			game_manager.load_state_from_server(existing_state)
			_refresh_grid()
			_refresh_hand()
			_update_counts()

func _mp_send_state_to_server() -> void:
	## Serialize game_manager state and POST to server.
	if not game_manager or not _mp_mode:
		return
	_mp_state_dirty = true
	if _mp_sync_pending:
		return  # Will be sent when current sync completes
	_mp_state_dirty = false
	_mp_sync_pending = true

	var state_dict: Dictionary = game_manager.serialize_for_server()
	# Update poll hash so the next poll skips our own state
	_mp_last_state_hash = JSON.stringify(state_dict)
	var url := "%s/api/lobbies/%s/game/state" % [_mp_base_url, _mp_lobby_id]
	var headers := ["Authorization: Bearer %s" % _mp_token, "Content-Type: application/json"]
	var body := JSON.stringify({"gameState": state_dict})
	var err := _mp_http_sync.request(url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		_add_log("HTTP sync hiba: %d" % err)
		_mp_sync_pending = false

func _on_mp_sync_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	_mp_sync_pending = false
	if result != HTTPRequest.RESULT_SUCCESS:
		_add_log("Sync hiba: result=%d" % result)
		# Still check dirty flag
		if _mp_state_dirty:
			_mp_send_state_to_server()
		return
	if response_code != 200:
		var json := JSON.new()
		var err := json.parse(body.get_string_from_utf8())
		if err == OK and json.data is Dictionary:
			_add_log(str(json.data.get("error", "Sync hiba: %d" % response_code)))
		else:
			_add_log("Sync hiba: %d" % response_code)
	# If state changed while sync was in-flight, resend latest state
	if _mp_state_dirty:
		_mp_send_state_to_server()
