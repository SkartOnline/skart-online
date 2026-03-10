## Main scene — entry point for the Godot game.
## Loads the arena when requested.
extends Control

@onready var arena: Control = $Arena

var _mp_requested: bool = false

func _ready() -> void:
	print("[Main] Skart 2 Online loaded")

	# Connect to JS bridge signals
	var bridge := get_node_or_null("/root/JSBridge")
	if bridge:
		bridge.game_start_requested.connect(_on_game_start)
		bridge.language_changed.connect(_on_language_changed)
		bridge.multiplayer_game_requested.connect(_on_multiplayer_game)

	# Wait a frame for multiplayer signal to fire (deferred from JSBridge)
	await get_tree().process_frame

	# If no multiplayer signal was received, show waiting message
	if not _mp_requested:
		print("[Main] No multiplayer data received. Waiting for lobby...")
		arena.dev_mode = true  ## Test/solo mode always enables dev mode
		arena.visible = true

func _on_game_start() -> void:
	print("[Main] Game starting...")
	arena.visible = true

func _on_multiplayer_game(lobby_id: String, auth_token: String, user_id: int, dev_mode: bool) -> void:
	_mp_requested = true
	print("[Main] Multiplayer game requested: lobby=%s user=%d dev=%s" % [lobby_id, user_id, str(dev_mode)])
	arena.visible = true
	if arena.has_method("start_multiplayer_game"):
		arena.start_multiplayer_game(lobby_id, auth_token, user_id, dev_mode)

func _on_language_changed(lang: String) -> void:
	print("[Main] Language changed to: %s" % lang)
	# Update Godot UI labels here if needed in the future
