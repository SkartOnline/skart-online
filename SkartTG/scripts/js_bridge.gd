## JS Bridge — autoload singleton for JavaScript ↔ Godot communication.
## Exposes callable methods from the web frontend.
extends Node

signal game_start_requested
signal language_changed(lang: String)
signal multiplayer_game_requested(lobby_id: String, auth_token: String, user_id: int, dev_mode: bool)

var is_web: bool = false
var _js_callbacks: Array = []  # Keep references alive

func _ready() -> void:
	is_web = OS.has_feature("web")
	if is_web:
		_setup_js_bridge()
		print("[JSBridge] Running in web mode, bridge initialized")
	else:
		print("[JSBridge] Running in desktop mode, no JS bridge")

func _setup_js_bridge() -> void:
	# Create callbacks that JS can call
	var start_game_cb := JavaScriptBridge.create_callback(_js_start_game)
	var set_lang_cb := JavaScriptBridge.create_callback(_js_set_language)
	_js_callbacks.append(start_game_cb)
	_js_callbacks.append(set_lang_cb)

	# Expose to JS global scope
	var window := JavaScriptBridge.get_interface("window")
	window.set("godotStartGame", start_game_cb)
	window.set("godotSetLanguage", set_lang_cb)

	# Check if multiplayer data was set by the parent page
	var mp_json_str = JavaScriptBridge.eval("JSON.stringify(window.parent.skartMultiplayerData || null)")
	if mp_json_str and str(mp_json_str) != "null" and str(mp_json_str) != "":
		var json := JSON.new()
		var err := json.parse(str(mp_json_str))
		if err == OK and json.data is Dictionary:
			var mp_data: Dictionary = json.data
			var lobby_id: String = str(mp_data.get("lobbyId", ""))
			var token: String = str(mp_data.get("token", ""))
			var user_id: int = int(mp_data.get("userId", 0))
			var dev_mode: bool = bool(mp_data.get("devMode", false))
			if lobby_id != "" and token != "":
				print("[JSBridge] Multiplayer data detected: lobby=%s user=%d dev=%s" % [lobby_id, user_id, str(dev_mode)])
				# Defer the signal to ensure main scene is ready
				call_deferred("_emit_multiplayer", lobby_id, token, user_id, dev_mode)
				return
		else:
			print("[JSBridge] Failed to parse multiplayer data: %s" % str(mp_json_str))

	# Signal to JS that Godot is ready (no multiplayer – test mode)
	JavaScriptBridge.eval("if (window.onGodotReady) window.onGodotReady();")

func _emit_multiplayer(lobby_id: String, token: String, user_id: int, dev_mode: bool) -> void:
	multiplayer_game_requested.emit(lobby_id, token, user_id, dev_mode)
	# Signal to JS that Godot is ready
	if is_web:
		JavaScriptBridge.eval("if (window.onGodotReady) window.onGodotReady();")

func _js_start_game(args: Array) -> void:
	print("[JSBridge] Start game requested from JS")
	game_start_requested.emit()

func _js_set_language(args: Array) -> void:
	if args.size() > 0:
		var lang := str(args[0])
		print("[JSBridge] Language change requested: %s" % lang)
		language_changed.emit(lang)

## Call JS function from Godot
func call_js(js_code: String) -> void:
	if is_web:
		JavaScriptBridge.eval(js_code)
