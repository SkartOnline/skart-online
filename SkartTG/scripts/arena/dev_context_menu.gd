## DevContextMenu — handles dev mode right-click menus, card browser, and stat editors.
## All dev actions bypass game rules and directly manipulate GameManager state.
class_name DevContextMenu
extends RefCounted

const CardDatabaseScript = preload("res://scripts/cards/card_database.gd")
const UnitInstanceScript = preload("res://scripts/arena/unit_instance.gd")
const CardScript = preload("res://scripts/cards/card.gd")

var arena: Control  ## Reference to the arena node (parent)
var game_manager  ## Reference to the GameManager

func _init(arena_ref: Control, gm_ref) -> void:
	arena = arena_ref
	game_manager = gm_ref

## ===========================
## CONTEXT MENU — PopupMenu at cursor
## ===========================

func show_context_menu(target_type: String, context: Dictionary, mouse_pos: Vector2) -> void:
	_dismiss_existing_popup()
	var popup := PopupMenu.new()
	popup.name = "DevPopupMenu"
	popup.theme_type_variation = "PopupMenu"
	popup.add_theme_font_size_override("font_size", 13)
	popup.add_theme_color_override("font_color", Color(0.92, 0.94, 0.97))

	match target_type:
		"unit":
			popup.add_item("Statisztika módosítása...", 0)
			popup.add_item("Kulcsszavak módosítása...", 1)
			popup.add_item("Áthelyezés...", 2)
			popup.add_item("Tulajdonos váltása", 3)
			popup.add_separator()
			popup.add_item("Megölés", 4)
			popup.add_item("Eltávolítás (száműzés)", 5)
			popup.add_separator()
			popup.add_item("Akciók visszaállítása", 6)
		"empty_cell":
			popup.add_item("Egység lehelyezése...", 10)
		"player_hand":
			popup.add_item("Kártya hozzáadása a kézhez...", 20)
			popup.add_item("Kéz ürítése", 21)
		"hand_card":
			popup.add_item("Kártya statok módosítása...", 160)
			popup.add_item("Eltávolítás a kézből", 161)
		"player_deck":
			popup.add_item("Kártya hozzáadása a pakliba...", 30)
			popup.add_item("Kártya húzása", 31)
			popup.add_item("Pakli megtekintése", 32)
		"player_discard":
			popup.add_item("Kártya hozzáadása...", 40)
			popup.add_item("Visszaadás kézbe...", 41)
			popup.add_item("Ürítés", 42)
		"player_pile":
			popup.add_item("Kártya hozzáadása...", 50)
			popup.add_item("Visszaadás kézbe...", 51)
			popup.add_item("Ürítés", 52)
		"player_character":
			popup.add_item("Karakter cseréje...", 60)
		"enemy_hand":
			popup.add_item("Kártya hozzáadása az ellenfél kezéhez...", 70)
			popup.add_item("Ellenfél kezének ürítése", 71)
		"enemy_deck":
			popup.add_item("Kártya hozzáadása az ellenfél paklijába...", 80)
		"enemy_discard":
			popup.add_item("Kártya hozzáadása...", 90)
			popup.add_item("Ürítés", 91)
		"enemy_pile":
			popup.add_item("Kártya hozzáadása...", 100)
			popup.add_item("Ürítés", 101)
		"enemy_character":
			popup.add_item("Karakter cseréje...", 110)
		"player_hp":
			popup.add_item("HP módosítása...", 120)
		"player_mana":
			popup.add_item("Mana módosítása...", 130)
		"enemy_hp":
			popup.add_item("Ellenfél HP módosítása...", 140)
		"enemy_mana":
			popup.add_item("Ellenfél mana módosítása...", 150)

	popup.id_pressed.connect(func(id: int): _on_menu_item_selected(id, context))
	arena.add_child(popup)
	popup.position = Vector2i(int(mouse_pos.x), int(mouse_pos.y))
	popup.popup()
	popup.popup_hide.connect(func(): popup.queue_free())

func _dismiss_existing_popup() -> void:
	var old := arena.get_node_or_null("DevPopupMenu")
	if old:
		old.queue_free()
	var old_overlay := arena.get_node_or_null("DevOverlay")
	if old_overlay:
		old_overlay.queue_free()

func _on_menu_item_selected(id: int, ctx: Dictionary) -> void:
	match id:
		0: _show_stat_editor(ctx)
		1: _show_keyword_editor(ctx)
		2: _start_move_unit(ctx)
		3: _toggle_owner(ctx)
		4: _kill_unit(ctx)
		5: _exile_unit(ctx)
		6: _reset_actions(ctx)
		10: _show_card_browser("unit", func(card): _summon_unit(card, ctx))
		20: _show_card_browser("non_character", func(card): _add_to_hand(card, "player"))
		21: _clear_hand("player")
		30: _show_card_browser("non_character", func(card): _add_to_deck(card, "player"))
		31: _draw_card()
		32: _show_zone_viewer(game_manager.player_deck, "Pakli")
		40: _show_card_browser("non_character", func(card): _add_to_zone(card, game_manager.player_discard, "player_discard"))
		41: _show_return_to_hand(game_manager.player_discard, "player_discard", "Temető")
		42: _clear_zone(game_manager.player_discard, "player_discard")
		50: _show_card_browser("non_character", func(card): _add_to_zone(card, game_manager.player_pile, "player_pile"))
		51: _show_return_to_hand(game_manager.player_pile, "player_pile", "Rakás")
		52: _clear_zone(game_manager.player_pile, "player_pile")
		60: _show_card_browser("character", func(card): _change_character(card, "player", ctx.get("slot", 0)))
		70: _show_card_browser("non_character", func(card): _add_to_hand(card, "enemy"))
		71: _clear_hand("enemy")
		80: _show_card_browser("non_character", func(card): _add_to_deck(card, "enemy"))
		90: _show_card_browser("non_character", func(card): _add_to_enemy_zone(card, "discard"))
		91: _clear_enemy_zone("discard")
		100: _show_card_browser("non_character", func(card): _add_to_enemy_zone(card, "pile"))
		101: _clear_enemy_zone("pile")
		110: _show_card_browser("character", func(card): _change_character(card, "enemy", ctx.get("slot", 0)))
		120: _show_number_editor("HP", game_manager.player_hp, func(val): game_manager.player_hp = val; _refresh())
		130: _show_mana_editor("player")
		140: _show_number_editor("Ellenfél HP", game_manager.enemy_hp, func(val): game_manager.enemy_hp = val; _refresh())
		150: _show_mana_editor("enemy")
		160: _show_hand_card_editor(int(ctx.get("hand_index", -1)))
		161: _remove_hand_card(int(ctx.get("hand_index", -1)))

## ===========================
## CARD BROWSER — full catalogue browser with filters
## ===========================

func _show_card_browser(filter_type: String, callback: Callable) -> void:
	_dismiss_existing_popup()

	var all_cards: Array = CardDatabaseScript.get_all_cards()

	# Pre-filter by type
	var pool: Array = []
	for card in all_cards:
		match filter_type:
			"unit":
				if card.card_type == 1:
					pool.append(card)
			"spell":
				if card.card_type == 2:
					pool.append(card)
			"character":
				if card.card_type == 0:
					pool.append(card)
			"non_character":
				if card.card_type != 0:
					pool.append(card)
			_:
				pool.append(card)

	# Sort by type then name
	pool.sort_custom(func(a, b):
		if a.card_type != b.card_type:
			return a.card_type < b.card_type
		return a.card_name < b.card_name
	)

	# Build overlay
	var overlay := Control.new()
	overlay.name = "DevOverlay"
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP

	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = Color(0, 0, 0, 0.7)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)

	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.06, 0.08, 0.12, 0.97)
	style.border_color = Color(0.25, 0.75, 0.4)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", style)
	panel.custom_minimum_size = Vector2(560, 450)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	panel.add_child(vbox)

	# Title
	var title_lbl := Label.new()
	title_lbl.text = "🃏 Katalógus — Kártya kiválasztása"
	title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_lbl.add_theme_font_size_override("font_size", 16)
	title_lbl.add_theme_color_override("font_color", Color(0.25, 0.75, 0.4))
	vbox.add_child(title_lbl)

	# Filter row
	var filter_row := HBoxContainer.new()
	filter_row.add_theme_constant_override("separation", 6)
	vbox.add_child(filter_row)

	var search_box := LineEdit.new()
	search_box.placeholder_text = "Keresés név alapján..."
	search_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search_box.add_theme_font_size_override("font_size", 13)
	var sb_style := StyleBoxFlat.new()
	sb_style.bg_color = Color(0.1, 0.12, 0.18)
	sb_style.border_color = Color(0.3, 0.35, 0.4)
	sb_style.set_border_width_all(1)
	sb_style.set_corner_radius_all(3)
	sb_style.set_content_margin_all(4)
	search_box.add_theme_stylebox_override("normal", sb_style)
	search_box.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	filter_row.add_child(search_box)

	# Type filter buttons
	var type_filters: Array = []
	if filter_type != "character" and filter_type != "unit" and filter_type != "spell":
		var btn_all := _make_filter_btn("Mind", true)
		filter_row.add_child(btn_all)
		type_filters.append({"btn": btn_all, "type": "all"})
		if filter_type != "spell":
			var btn_unit := _make_filter_btn("Egység", false)
			filter_row.add_child(btn_unit)
			type_filters.append({"btn": btn_unit, "type": "unit"})
		if filter_type != "unit":
			var btn_spell := _make_filter_btn("Varázslat", false)
			filter_row.add_child(btn_spell)
			type_filters.append({"btn": btn_spell, "type": "spell"})

	vbox.add_child(HSeparator.new())

	# Scrollable card list
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 300)
	vbox.add_child(scroll)

	var card_list := VBoxContainer.new()
	card_list.name = "CardList"
	card_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card_list.add_theme_constant_override("separation", 3)
	scroll.add_child(card_list)

	# Cancel button
	var cancel_btn := Button.new()
	cancel_btn.text = "Mégse"
	cancel_btn.custom_minimum_size = Vector2(100, 32)
	var cancel_style := StyleBoxFlat.new()
	cancel_style.bg_color = Color(0.25, 0.08, 0.08)
	cancel_style.border_color = Color(0.6, 0.2, 0.2)
	cancel_style.set_border_width_all(1)
	cancel_style.set_corner_radius_all(4)
	cancel_style.set_content_margin_all(4)
	cancel_btn.add_theme_stylebox_override("normal", cancel_style)
	cancel_btn.add_theme_color_override("font_color", Color(0.9, 0.7, 0.7))
	cancel_btn.add_theme_font_size_override("font_size", 13)
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	vbox.add_child(cancel_btn)

	arena.add_child(overlay)

	# Populate card list
	var active_type_filter: Array = ["all"]  # Use array to allow mutation in closures
	var _populate = func():
		for child in card_list.get_children():
			child.queue_free()
		var search_text: String = search_box.text.strip_edges().to_lower()
		for card in pool:
			# Type filter
			if active_type_filter[0] == "unit" and card.card_type != 1:
				continue
			if active_type_filter[0] == "spell" and card.card_type != 2:
				continue
			# Text filter
			if search_text != "" and card.card_name.to_lower().find(search_text) < 0:
				continue
			var row := _make_card_row(card)
			var card_ref = card
			var overlay_ref = overlay
			var cb_ref = callback
			row.gui_input.connect(func(ev):
				if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
					cb_ref.call(card_ref)
					overlay_ref.queue_free()
					_refresh()
			)
			card_list.add_child(row)

	_populate.call()

	# Connect search and filter events
	search_box.text_changed.connect(func(_t): _populate.call())
	for tf in type_filters:
		var tf_ref = tf
		tf["btn"].pressed.connect(func():
			active_type_filter[0] = tf_ref["type"]
			for tf2 in type_filters:
				_set_filter_btn_active(tf2["btn"], tf2["type"] == active_type_filter[0])
			_populate.call()
		)

func _make_filter_btn(text: String, active: bool) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.custom_minimum_size = Vector2(70, 28)
	btn.add_theme_font_size_override("font_size", 12)
	_set_filter_btn_active(btn, active)
	return btn

func _set_filter_btn_active(btn: Button, active: bool) -> void:
	var s := StyleBoxFlat.new()
	if active:
		s.bg_color = Color(0.15, 0.35, 0.15)
		s.border_color = Color(0.3, 0.7, 0.3)
	else:
		s.bg_color = Color(0.1, 0.12, 0.18)
		s.border_color = Color(0.25, 0.3, 0.35)
	s.set_border_width_all(1)
	s.set_corner_radius_all(3)
	s.set_content_margin_all(4)
	btn.add_theme_stylebox_override("normal", s)
	btn.add_theme_color_override("font_color", Color(0.85, 0.88, 0.92) if active else Color(0.5, 0.55, 0.6))

func _make_card_row(card) -> PanelContainer:
	var panel := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.09, 0.11, 0.16)
	s.border_color = Color(0.2, 0.24, 0.3)
	s.set_border_width_all(1)
	s.set_corner_radius_all(3)
	s.set_content_margin_all(6)
	panel.add_theme_stylebox_override("panel", s)
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 8)
	hbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(hbox)

	# Cost
	var cost_lbl := Label.new()
	cost_lbl.text = str(card.cost) if card.get("cost") != null else "-"
	cost_lbl.custom_minimum_size = Vector2(24, 0)
	cost_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cost_lbl.add_theme_font_size_override("font_size", 14)
	cost_lbl.add_theme_color_override("font_color", Color(0.3, 0.6, 0.9))
	cost_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hbox.add_child(cost_lbl)

	# Name
	var name_lbl := Label.new()
	name_lbl.text = card.card_name
	name_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_lbl.add_theme_font_size_override("font_size", 13)
	name_lbl.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	name_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hbox.add_child(name_lbl)

	# Type badge
	var type_lbl := Label.new()
	match card.card_type:
		0: type_lbl.text = "Karakter"
		1:
			type_lbl.text = "Egység"
			if card.get("attack") != null:
				type_lbl.text += " %d/%d" % [card.attack, card.hp]
		2:
			type_lbl.text = "Varázslat"
			if card.get("spell_type"):
				type_lbl.text = str(card.spell_type)
		_: type_lbl.text = "Egyéb"
	type_lbl.add_theme_font_size_override("font_size", 11)
	type_lbl.add_theme_color_override("font_color", Color(0.6, 0.6, 0.65))
	type_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hbox.add_child(type_lbl)

	return panel

## ===========================
## STAT EDITOR — modify unit stats
## ===========================

func _show_stat_editor(ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return

	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "⚙ Statisztika módosítása — %s" % unit.card.card_name)

	var fields: Array = [
		{"label": "Támadás (base)", "value": unit.current_attack, "key": "attack"},
		{"label": "HP (base)", "value": unit.current_hp, "key": "hp"},
		{"label": "Gyűrűk", "value": unit.rings, "key": "rings"},
		{"label": "Mana költség", "value": unit.card.cost if unit.card.get("cost") != null else 0, "key": "cost"},
		{"label": "Mozgás (base)", "value": unit.card.move_speed if unit.card.get("move_speed") else 1, "key": "move_speed"},
		{"label": "Lövéstáv", "value": unit.card.attack_range if unit.card.get("attack_range") else 1, "key": "range"},
	]

	var inputs: Dictionary = {}
	var vbox: VBoxContainer = panel.get_child(0)
	for f in fields:
		var row_hbox := HBoxContainer.new()
		row_hbox.add_theme_constant_override("separation", 8)
		var lbl := Label.new()
		lbl.text = f["label"]
		lbl.custom_minimum_size = Vector2(140, 0)
		lbl.add_theme_font_size_override("font_size", 13)
		lbl.add_theme_color_override("font_color", Color(0.8, 0.82, 0.86))
		row_hbox.add_child(lbl)
		var input := LineEdit.new()
		input.text = str(f["value"])
		input.custom_minimum_size = Vector2(80, 0)
		input.add_theme_font_size_override("font_size", 13)
		var is_style := StyleBoxFlat.new()
		is_style.bg_color = Color(0.1, 0.12, 0.18)
		is_style.border_color = Color(0.3, 0.35, 0.4)
		is_style.set_border_width_all(1)
		is_style.set_corner_radius_all(3)
		is_style.set_content_margin_all(4)
		input.add_theme_stylebox_override("normal", is_style)
		input.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
		row_hbox.add_child(input)
		inputs[f["key"]] = input
		vbox.add_child(row_hbox)

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 8)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(btn_row)

	var apply_btn := _make_action_btn("Alkalmaz", Color(0.15, 0.35, 0.15), Color(0.3, 0.7, 0.3))
	apply_btn.pressed.connect(func():
		unit.current_attack = int(inputs["attack"].text)
		unit.current_hp = int(inputs["hp"].text)
		unit.rings = int(inputs["rings"].text)
		if unit.card.get("cost") != null:
			unit.card.cost = int(inputs["cost"].text)
		if unit.card.get("move_speed") != null:
			unit.card.move_speed = int(inputs["move_speed"].text)
		if unit.card.get("attack_range") != null:
			unit.card.attack_range = int(inputs["range"].text)
		overlay.queue_free()
		_refresh()
		_log("DEV: %s statisztikák módosítva" % unit.card.card_name)
	)
	btn_row.add_child(apply_btn)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	btn_row.add_child(cancel_btn)
	arena.add_child(overlay)

## ===========================
## KEYWORD EDITOR
## ===========================

func _show_keyword_editor(ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return

	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "🏷 Kulcsszavak — %s" % unit.card.card_name)
	var vbox: VBoxContainer = panel.get_child(0)

	var known_keywords := ["stunned", "shield", "stealth", "taunt", "rush", "charge",
		"flying", "regeneration", "first_strike", "lifesteal", "trample", "ward"]
	var active: Dictionary = {}
	for kw in unit.keywords:
		active[kw] = true

	var checkboxes: Dictionary = {}
	for kw in known_keywords:
		var cb := CheckBox.new()
		cb.text = kw
		cb.button_pressed = active.has(kw)
		cb.add_theme_font_size_override("font_size", 13)
		cb.add_theme_color_override("font_color", Color(0.85, 0.88, 0.92))
		checkboxes[kw] = cb
		vbox.add_child(cb)

	# Custom keyword input
	var custom_row := HBoxContainer.new()
	custom_row.add_theme_constant_override("separation", 6)
	var custom_input := LineEdit.new()
	custom_input.placeholder_text = "Egyéni kulcsszó..."
	custom_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	custom_input.add_theme_font_size_override("font_size", 13)
	var cis := StyleBoxFlat.new()
	cis.bg_color = Color(0.1, 0.12, 0.18)
	cis.border_color = Color(0.3, 0.35, 0.4)
	cis.set_border_width_all(1)
	cis.set_corner_radius_all(3)
	cis.set_content_margin_all(4)
	custom_input.add_theme_stylebox_override("normal", cis)
	custom_input.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	custom_row.add_child(custom_input)
	vbox.add_child(custom_row)

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 8)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(btn_row)

	var apply_btn := _make_action_btn("Alkalmaz", Color(0.15, 0.35, 0.15), Color(0.3, 0.7, 0.3))
	apply_btn.pressed.connect(func():
		unit.keywords.clear()
		for kw in known_keywords:
			if checkboxes[kw].button_pressed:
				unit.keywords.append(kw)
		var custom: String = custom_input.text.strip_edges()
		if custom != "":
			for part in custom.split(","):
				var kw := part.strip_edges()
				if kw != "" and not unit.keywords.has(kw):
					unit.keywords.append(kw)
		overlay.queue_free()
		_refresh()
		_log("DEV: %s kulcsszavak módosítva: %s" % [unit.card.card_name, str(unit.keywords)])
	)
	btn_row.add_child(apply_btn)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	btn_row.add_child(cancel_btn)
	arena.add_child(overlay)

## ===========================
## NUMBER EDITOR — simple single-value dialog
## ===========================

func _show_number_editor(label: String, current_value: int, callback: Callable) -> void:
	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "✏ %s módosítása" % label)
	var vbox: VBoxContainer = panel.get_child(0)

	var row_hbox := HBoxContainer.new()
	row_hbox.add_theme_constant_override("separation", 8)
	row_hbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var lbl := Label.new()
	lbl.text = "%s:" % label
	lbl.add_theme_font_size_override("font_size", 14)
	lbl.add_theme_color_override("font_color", Color(0.8, 0.82, 0.86))
	row_hbox.add_child(lbl)
	var input := LineEdit.new()
	input.text = str(current_value)
	input.custom_minimum_size = Vector2(80, 0)
	input.add_theme_font_size_override("font_size", 14)
	var is_style := StyleBoxFlat.new()
	is_style.bg_color = Color(0.1, 0.12, 0.18)
	is_style.border_color = Color(0.3, 0.35, 0.4)
	is_style.set_border_width_all(1)
	is_style.set_corner_radius_all(3)
	is_style.set_content_margin_all(4)
	input.add_theme_stylebox_override("normal", is_style)
	input.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	row_hbox.add_child(input)
	vbox.add_child(row_hbox)

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 8)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(btn_row)

	var apply_btn := _make_action_btn("Alkalmaz", Color(0.15, 0.35, 0.15), Color(0.3, 0.7, 0.3))
	apply_btn.pressed.connect(func():
		callback.call(int(input.text))
		overlay.queue_free()
		_refresh()
		_log("DEV: %s → %s" % [label, input.text])
	)
	btn_row.add_child(apply_btn)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	btn_row.add_child(cancel_btn)
	arena.add_child(overlay)

## ===========================
## MANA EDITOR — mana + max_mana
## ===========================

func _show_mana_editor(who: String) -> void:
	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var is_player := who == "player"
	var title := "Mana" if is_player else "Ellenfél Mana"
	var panel := _make_dialog_panel(overlay, "✏ %s módosítása" % title)
	var vbox: VBoxContainer = panel.get_child(0)

	var cur_mana: int = game_manager.player_mana if is_player else game_manager.enemy_mana
	var cur_max: int = game_manager.player_max_mana if is_player else game_manager.enemy_max_mana

	var input_mana := _make_labeled_input(vbox, "Jelenlegi mana:", str(cur_mana))
	var input_max := _make_labeled_input(vbox, "Max mana:", str(cur_max))

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 8)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(btn_row)

	var apply_btn := _make_action_btn("Alkalmaz", Color(0.15, 0.35, 0.15), Color(0.3, 0.7, 0.3))
	apply_btn.pressed.connect(func():
		if is_player:
			game_manager.player_mana = int(input_mana.text)
			game_manager.player_max_mana = int(input_max.text)
		else:
			game_manager.enemy_mana = int(input_mana.text)
			game_manager.enemy_max_mana = int(input_max.text)
		overlay.queue_free()
		_refresh()
		_log("DEV: %s → %s/%s" % [title, input_mana.text, input_max.text])
	)
	btn_row.add_child(apply_btn)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	btn_row.add_child(cancel_btn)
	arena.add_child(overlay)

func _show_hand_card_editor(hand_index: int) -> void:
	if hand_index < 0 or hand_index >= game_manager.player_hand.size():
		return
	var card = game_manager.player_hand[hand_index]

	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "✏ Kézben lévő kártya — %s" % card.card_name)
	var vbox: VBoxContainer = panel.get_child(0)

	var fields: Array = [
		{"label": "Mana költség", "value": card.cost if card.get("cost") != null else 0, "key": "cost"},
		{"label": "Támadás", "value": card.attack if card.get("attack") != null else 0, "key": "attack"},
		{"label": "HP", "value": card.hp if card.get("hp") != null else 0, "key": "hp"},
		{"label": "Mozgás", "value": card.move_speed if card.get("move_speed") != null else 1, "key": "move_speed"},
		{"label": "Lőtáv", "value": card.attack_range if card.get("attack_range") != null else 1, "key": "range"},
	]

	var inputs: Dictionary = {}
	for f in fields:
		var input := _make_labeled_input(vbox, "%s:" % str(f["label"]), str(f["value"]))
		inputs[f["key"]] = input

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 8)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(btn_row)

	var apply_btn := _make_action_btn("Alkalmaz", Color(0.15, 0.35, 0.15), Color(0.3, 0.7, 0.3))
	apply_btn.pressed.connect(func():
		if card.get("cost") != null:
			card.cost = int(inputs["cost"].text)
		if card.get("attack") != null:
			card.attack = int(inputs["attack"].text)
		if card.get("hp") != null:
			card.hp = int(inputs["hp"].text)
		if card.get("move_speed") != null:
			card.move_speed = int(inputs["move_speed"].text)
		if card.get("attack_range") != null:
			card.attack_range = int(inputs["range"].text)
		overlay.queue_free()
		_refresh()
		_log("DEV: Kézben lévő kártya módosítva: %s" % card.card_name)
	)
	btn_row.add_child(apply_btn)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	btn_row.add_child(cancel_btn)

	arena.add_child(overlay)

## ===========================
## ZONE VIEWER — read-only card list
## ===========================

func _show_zone_viewer(zone: Array, title: String) -> void:
	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "📋 %s (%d kártya)" % [title, zone.size()])
	var vbox: VBoxContainer = panel.get_child(0)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 250)
	vbox.add_child(scroll)

	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 2)
	scroll.add_child(list)

	for i in range(zone.size()):
		var card = zone[i]
		var lbl := Label.new()
		lbl.text = "%d. %s (ID: %d)" % [i + 1, card.card_name, card.card_id]
		lbl.add_theme_font_size_override("font_size", 12)
		lbl.add_theme_color_override("font_color", Color(0.8, 0.82, 0.86))
		list.add_child(lbl)

	if zone.is_empty():
		var empty_lbl := Label.new()
		empty_lbl.text = "(üres)"
		empty_lbl.add_theme_font_size_override("font_size", 13)
		empty_lbl.add_theme_color_override("font_color", Color(0.5, 0.52, 0.56))
		list.add_child(empty_lbl)

	var close_btn := _make_action_btn("Bezárás", Color(0.12, 0.14, 0.2), Color(0.3, 0.35, 0.4))
	close_btn.pressed.connect(func(): overlay.queue_free())
	vbox.add_child(close_btn)
	arena.add_child(overlay)

## ===========================
## RETURN TO HAND — pick card from zone to move to hand
## ===========================

func _show_return_to_hand(zone: Array, _zone_name: String, display_name: String) -> void:
	if zone.is_empty():
		_log("DEV: %s üres!" % display_name)
		return
	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "↩ Visszaadás kézbe — %s" % display_name)
	var vbox: VBoxContainer = panel.get_child(0)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 250)
	vbox.add_child(scroll)

	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 3)
	scroll.add_child(list)

	for i in range(zone.size()):
		var card = zone[i]
		var row_panel := _make_card_row(card)
		var idx = i
		var overlay_ref = overlay
		var zone_ref = zone
		row_panel.gui_input.connect(func(ev):
			if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
				if idx < zone_ref.size():
					var picked = zone_ref[idx]
					zone_ref.remove_at(idx)
					game_manager.player_hand.append(picked)
					game_manager.hand_updated.emit()
				overlay_ref.queue_free()
				_refresh()
				_log("DEV: Kártya visszaadva kézbe a %s zónából" % display_name)
		)
		list.add_child(row_panel)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	vbox.add_child(cancel_btn)
	arena.add_child(overlay)

## ===========================
## DEV ACTIONS — direct game state manipulation
## ===========================

func _summon_unit(card, ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	if row < 0 or col < 0:
		return
	var owner_id: int = 0  # Default: player's unit
	# Determine owner based on base row proximity
	if game_manager.enemy_base_row >= 0:
		var player_dist := absi(row - game_manager.player_base_row)
		var enemy_dist := absi(row - game_manager.enemy_base_row)
		if enemy_dist < player_dist:
			owner_id = 1
	var unit = UnitInstanceScript.new(card, owner_id)
	unit.grid_row = row
	unit.grid_col = col
	game_manager.grid[row][col] = unit
	_refresh()
	_log("DEV: %s lehelyezve (%d,%d) tulajdonos=%s" % [card.card_name, row, col, "Játékos" if owner_id == 0 else "Ellenfél"])

func _add_to_hand(card, who: String) -> void:
	if who == "player":
		game_manager.player_hand.append(card.duplicate())
		game_manager.hand_updated.emit()
		_log("DEV: %s hozzáadva a kézhez" % card.card_name)
	else:
		game_manager.enemy_hand_ids.append(card.card_id)
		game_manager.enemy_hand_count = game_manager.enemy_hand_ids.size()
		_log("DEV: %s hozzáadva az ellenfél kezéhez" % card.card_name)

func _add_to_deck(card, who: String) -> void:
	if who == "player":
		game_manager.player_deck.append(card.duplicate())
		_log("DEV: %s hozzáadva a paklihoz" % card.card_name)
	else:
		game_manager.enemy_deck_ids.append(card.card_id)
		_log("DEV: %s hozzáadva az ellenfél paklijához" % card.card_name)

func _add_to_zone(card, zone: Array, _zone_name: String) -> void:
	zone.append(card.duplicate())
	_log("DEV: %s hozzáadva" % card.card_name)

func _add_to_enemy_zone(card, zone_type: String) -> void:
	match zone_type:
		"discard":
			game_manager.enemy_discard_ids.append(card.card_id)
			_log("DEV: %s hozzáadva az ellenfél temetőjéhez" % card.card_name)
		"pile":
			game_manager.enemy_pile_ids.append(card.card_id)
			_log("DEV: %s hozzáadva az ellenfél rakásához" % card.card_name)

func _clear_hand(who: String) -> void:
	if who == "player":
		game_manager.player_hand.clear()
		game_manager.hand_updated.emit()
		_log("DEV: Kéz kiürítve")
	else:
		game_manager.enemy_hand_ids.clear()
		game_manager.enemy_hand_count = 0
		_log("DEV: Ellenfél keze kiürítve")

func _remove_hand_card(hand_index: int) -> void:
	if hand_index < 0 or hand_index >= game_manager.player_hand.size():
		return
	var card = game_manager.player_hand[hand_index]
	game_manager.player_hand.remove_at(hand_index)
	game_manager.hand_updated.emit()
	_refresh()
	_log("DEV: Kézből eltávolítva: %s" % card.card_name)

func _clear_zone(zone: Array, _zone_name: String) -> void:
	zone.clear()
	_refresh()
	_log("DEV: Zóna kiürítve")

func _clear_enemy_zone(zone_type: String) -> void:
	match zone_type:
		"discard":
			game_manager.enemy_discard_ids.clear()
			_log("DEV: Ellenfél temetője kiürítve")
		"pile":
			game_manager.enemy_pile_ids.clear()
			_log("DEV: Ellenfél rakása kiürítve")
	_refresh()

func _draw_card() -> void:
	if game_manager.player_deck.is_empty():
		_log("DEV: A pakli üres!")
		return
	var card = game_manager.player_deck.pop_back()
	game_manager.player_hand.append(card)
	game_manager.hand_updated.emit()
	_refresh()
	_log("DEV: Kártya húzva: %s" % card.card_name)

func _start_move_unit(ctx: Dictionary) -> void:
	# For simplicity, show a grid position input
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return

	_dismiss_existing_popup()
	var overlay := _make_overlay()
	var panel := _make_dialog_panel(overlay, "📍 Áthelyezés — %s" % unit.card.card_name)
	var vbox: VBoxContainer = panel.get_child(0)

	var info_lbl := Label.new()
	info_lbl.text = "Jelenlegi pozíció: (%d, %d)" % [row, col]
	info_lbl.add_theme_font_size_override("font_size", 13)
	info_lbl.add_theme_color_override("font_color", Color(0.7, 0.72, 0.76))
	vbox.add_child(info_lbl)

	var input_row := _make_labeled_input(vbox, "Új sor (0-4):", str(row))
	var input_col := _make_labeled_input(vbox, "Új oszlop (0-4):", str(col))

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 8)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(btn_row)

	var apply_btn := _make_action_btn("Áthelyezés", Color(0.15, 0.35, 0.15), Color(0.3, 0.7, 0.3))
	apply_btn.pressed.connect(func():
		var new_row: int = clampi(int(input_row.text), 0, 4)
		var new_col: int = clampi(int(input_col.text), 0, 4)
		if game_manager.get_unit_at(new_row, new_col) and (new_row != row or new_col != col):
			_log("DEV: A cél mező foglalt!")
			overlay.queue_free()
			return
		game_manager.grid[row][col] = null
		game_manager.grid[new_row][new_col] = unit
		unit.grid_row = new_row
		unit.grid_col = new_col
		overlay.queue_free()
		_refresh()
		_log("DEV: %s áthelyezve (%d,%d) → (%d,%d)" % [unit.card.card_name, row, col, new_row, new_col])
	)
	btn_row.add_child(apply_btn)

	var cancel_btn := _make_action_btn("Mégse", Color(0.25, 0.08, 0.08), Color(0.6, 0.2, 0.2))
	cancel_btn.pressed.connect(func(): overlay.queue_free())
	btn_row.add_child(cancel_btn)
	arena.add_child(overlay)

func _toggle_owner(ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return
	unit.owner_id = 1 if unit.owner_id == 0 else 0
	_refresh()
	_log("DEV: %s tulajdonos váltva → %s" % [unit.card.card_name, "Játékos" if unit.owner_id == 0 else "Ellenfél"])

func _kill_unit(ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return
	game_manager._kill_unit(row, col, null)
	_refresh()
	_log("DEV: %s megölve" % unit.card.card_name)

func _exile_unit(ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return
	game_manager.grid[row][col] = null
	_refresh()
	_log("DEV: %s eltávolítva (száműzve)" % unit.card.card_name)

func _reset_actions(ctx: Dictionary) -> void:
	var row: int = ctx.get("row", -1)
	var col: int = ctx.get("col", -1)
	var unit = game_manager.get_unit_at(row, col)
	if not unit:
		return
	unit.has_attacked = false
	unit.has_moved = false
	unit.moves_remaining = unit.get_effective_move_speed()
	_refresh()
	_log("DEV: %s akciók visszaállítva" % unit.card.card_name)

func _change_character(card, who: String, slot: int) -> void:
	var chars: Array = game_manager.player_characters if who == "player" else game_manager.enemy_characters
	if slot < chars.size():
		chars[slot] = card.duplicate()
	else:
		chars.append(card.duplicate())
	_refresh()
	_log("DEV: %s karakter beállítva (%s, slot %d)" % [card.card_name, who, slot])

## ===========================
## UI HELPERS
## ===========================

func _make_overlay() -> Control:
	var overlay := Control.new()
	overlay.name = "DevOverlay"
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = Color(0, 0, 0, 0.7)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(bg)
	return overlay

func _make_dialog_panel(overlay: Control, title: String) -> PanelContainer:
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)

	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.06, 0.08, 0.12, 0.97)
	style.border_color = Color(0.831, 0.659, 0.263)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", style)
	panel.custom_minimum_size = Vector2(380, 0)
	center.add_child(panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	panel.add_child(vbox)

	var title_lbl := Label.new()
	title_lbl.text = title
	title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_lbl.add_theme_font_size_override("font_size", 15)
	title_lbl.add_theme_color_override("font_color", Color(0.831, 0.659, 0.263))
	vbox.add_child(title_lbl)
	vbox.add_child(HSeparator.new())

	return panel

func _make_action_btn(text: String, bg_color: Color, border_color: Color) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.custom_minimum_size = Vector2(100, 32)
	var s := StyleBoxFlat.new()
	s.bg_color = bg_color
	s.border_color = border_color
	s.set_border_width_all(1)
	s.set_corner_radius_all(4)
	s.set_content_margin_all(6)
	btn.add_theme_stylebox_override("normal", s)
	var h := s.duplicate()
	h.bg_color = bg_color.lightened(0.15)
	btn.add_theme_stylebox_override("hover", h)
	btn.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	btn.add_theme_font_size_override("font_size", 13)
	return btn

func _make_labeled_input(parent: VBoxContainer, label_text: String, value: String) -> LineEdit:
	var row_hbox := HBoxContainer.new()
	row_hbox.add_theme_constant_override("separation", 8)
	row_hbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var lbl := Label.new()
	lbl.text = label_text
	lbl.custom_minimum_size = Vector2(120, 0)
	lbl.add_theme_font_size_override("font_size", 13)
	lbl.add_theme_color_override("font_color", Color(0.8, 0.82, 0.86))
	row_hbox.add_child(lbl)
	var input := LineEdit.new()
	input.text = value
	input.custom_minimum_size = Vector2(80, 0)
	input.add_theme_font_size_override("font_size", 13)
	var is_style := StyleBoxFlat.new()
	is_style.bg_color = Color(0.1, 0.12, 0.18)
	is_style.border_color = Color(0.3, 0.35, 0.4)
	is_style.set_border_width_all(1)
	is_style.set_corner_radius_all(3)
	is_style.set_content_margin_all(4)
	input.add_theme_stylebox_override("normal", is_style)
	input.add_theme_color_override("font_color", Color(0.9, 0.92, 0.95))
	row_hbox.add_child(input)
	parent.add_child(row_hbox)
	return input

## ===========================
## REFRESH + LOG — delegate to arena
## ===========================

func _refresh() -> void:
	if arena.has_method("_refresh_grid"):
		arena._refresh_grid()
	if arena.has_method("_refresh_hand"):
		arena._refresh_hand()
	if arena.has_method("_update_counts"):
		arena._update_counts()
	# Sync state to server in multiplayer (regardless of whose turn it is)
	if arena.get("_mp_mode") and arena.has_method("_mp_send_state_to_server"):
		arena._mp_send_state_to_server()
	elif game_manager:
		game_manager._emit_state_changed()

func _log(msg: String) -> void:
	if arena.has_method("_add_log"):
		arena._add_log(msg)
