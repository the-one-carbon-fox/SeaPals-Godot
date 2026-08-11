extends Node2D

signal condition_drawn(condition_name: String)
signal _reset()

var events: Array[String] = []

const SEA_DEEP := Color(0.024, 0.157, 0.239, 1.0)
const SEA_PANEL := Color(0.043, 0.365, 0.459, 1.0)
const SEA_FOAM := Color(0.843, 1.0, 0.969, 1.0)
const CORAL := Color(1.0, 0.498, 0.431, 1.0)
const GOLD := Color(1.0, 0.82, 0.4, 1.0)
const LOGO_TEXTURE := preload("res://assets/Images/ui/searealm_logo.svg")

func _ready() -> void:
	_build_table_backdrop()
	_style_condition_deck_area()
	_style_draw_button()
	_style_player_boards()
	load_conditions()


func load_conditions() -> void:
	var path: String = "res://assets/Conditions-Deck/default.json"
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)

	if file == null:
		push_error("Could not open JSON file at: " + path)
		return

	var json_text: String = file.get_as_text()
	var data: Variant = JSON.parse_string(json_text)

	if typeof(data) != TYPE_DICTIONARY or not data.has("events"):
		push_error("JSON format error: missing 'events' array")
		return

	# Convert Variant array → typed Array[String]
	var raw_events: Array = data["events"]
	events = []
	for e in raw_events:
		events.append(String(e))

	print("Loaded", events.size(), "condition cards.")
	


func pick_random_condition() -> String:
	if events.is_empty():
		push_error("No events loaded!")
		return ""

	var index: int = randi() % events.size()
	return events[index]


func _on_draw_pressed() -> void:
	if events.is_empty():
		emit_signal("condition_drawn","OOC")
		_reset_deck()
		return

	var index: int = randi() % events.size()
	var condition: String = events[index]

	# Remove the card so it cannot be drawn again
	events.remove_at(index)

	print("Drew condition:", condition)
	emit_signal("condition_drawn", condition)

func _reset_deck() -> void:
	load_conditions()
	print("Deck reset!")
	emit_signal("_reset")


func _build_table_backdrop() -> void:
	var background := ColorRect.new()
	background.name = "OceanTableBackdrop"
	background.position = Vector2.ZERO
	background.size = Vector2(1280.0, 720.0)
	background.color = Color(0.004, 0.052, 0.087, 1.0)
	background.z_index = -40
	add_child(background)
	move_child(background, 0)

	var playmat := ColorRect.new()
	playmat.name = "CurrentPlaymat"
	playmat.position = Vector2(632.0, 42.0)
	playmat.size = Vector2(590.0, 585.0)
	playmat.color = Color(SEA_PANEL.r, SEA_PANEL.g, SEA_PANEL.b, 0.72)
	playmat.z_index = -35
	add_child(playmat)
	move_child(playmat, 1)

	var title := Label.new()
	title.name = "RoundTitle"
	title.text = "Condition Current"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.position = Vector2(650.0, 62.0)
	title.size = Vector2(545.0, 50.0)
	title.add_theme_color_override("font_color", SEA_FOAM)
	title.add_theme_font_size_override("font_size", 34)
	title.z_index = -10
	add_child(title)

	var logo := TextureRect.new()
	logo.name = "SeaRealmWatermark"
	logo.texture = LOGO_TEXTURE
	logo.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.position = Vector2(694.0, 112.0)
	logo.size = Vector2(455.0, 95.0)
	logo.modulate = Color(1.0, 1.0, 1.0, 0.82)
	logo.z_index = -9
	add_child(logo)

	for i in range(8):
		var ripple := Label.new()
		ripple.name = "Ripple%d" % i
		ripple.text = "~"
		ripple.position = Vector2(650.0 + i * 68.0, 555.0 + (i % 2) * 24.0)
		ripple.add_theme_color_override("font_color", Color(SEA_FOAM.r, SEA_FOAM.g, SEA_FOAM.b, 0.22))
		ripple.add_theme_font_size_override("font_size", 36)
		ripple.z_index = -15
		add_child(ripple)


func _style_condition_deck_area() -> void:
	var deck_glow := ColorRect.new()
	deck_glow.name = "SidewaysCardGlow"
	deck_glow.position = Vector2(728.0, 212.0)
	deck_glow.size = Vector2(410.0, 270.0)
	deck_glow.color = Color(0.0, 0.74, 0.95, 0.18)
	deck_glow.z_index = -8
	add_child(deck_glow)

	var deck_shadow := ColorRect.new()
	deck_shadow.name = "SidewaysCardShadow"
	deck_shadow.position = Vector2(760.0, 245.0)
	deck_shadow.size = Vector2(350.0, 210.0)
	deck_shadow.color = Color(0.0, 0.02, 0.04, 0.32)
	deck_shadow.z_index = -7
	add_child(deck_shadow)

	var reef_colors := [
		Color(1.0, 0.41, 0.32, 0.74),
		Color(1.0, 0.82, 0.4, 0.72),
		Color(0.0, 0.78, 0.64, 0.62),
	]
	for i in range(7):
		var sea_grass := Polygon2D.new()
		sea_grass.name = "DeckSeaGrass%d" % i
		var x := 714.0 + i * 72.0
		var height := 58.0 + (i % 3) * 18.0
		sea_grass.polygon = PackedVector2Array([
			Vector2(x, 525.0),
			Vector2(x + 18.0, 525.0 - height),
			Vector2(x + 34.0, 525.0),
		])
		sea_grass.color = reef_colors[i % reef_colors.size()]
		sea_grass.z_index = -6
		add_child(sea_grass)

	for i in range(5):
		var current := Label.new()
		current.name = "DeckCurrent%d" % i
		current.text = "~"
		current.position = Vector2(735.0 + i * 82.0, 474.0 + (i % 2) * 18.0)
		current.add_theme_color_override("font_color", Color(SEA_FOAM.r, SEA_FOAM.g, SEA_FOAM.b, 0.42))
		current.add_theme_font_size_override("font_size", 34)
		current.z_index = -5
		add_child(current)

	var deck := $ConditionDeck as Sprite2D
	deck.position = Vector2(936.0, 348.0)
	deck.rotation_degrees = -90.0
	deck.scale = Vector2(0.48, 0.48)
	deck.z_index = 4


func _style_draw_button() -> void:
	var draw_button := $Draw as Button
	draw_button.position = Vector2(706.0, 641.0)
	draw_button.size = Vector2(452.0, 58.0)
	draw_button.text = "Draw the Next Current"
	draw_button.add_theme_font_size_override("font_size", 25)
	draw_button.add_theme_color_override("font_color", Color(0.027, 0.141, 0.208, 1.0))
	draw_button.add_theme_stylebox_override("normal", _rounded_box(CORAL, 16))
	draw_button.add_theme_stylebox_override("hover", _rounded_box(GOLD, 16))
	draw_button.add_theme_stylebox_override("pressed", _rounded_box(Color(0.914, 0.427, 0.376, 1.0), 16))


func _style_player_boards() -> void:
	var colors := [
		Color(0.094, 0.651, 0.851, 1.0),
		Color(0.184, 0.365, 0.729, 1.0),
		Color(0.0, 0.659, 0.471, 1.0),
		Color(0.541, 0.361, 0.965, 1.0),
	]
	for i in range(4):
		var board := get_node_or_null("P%d/ColorRect" % (i + 1)) as ColorRect
		if board == null:
			continue
		board.color = Color(colors[i].r, colors[i].g, colors[i].b, 0.86)
		var label := get_node_or_null("P%d/Player %d" % [i + 1, i + 1]) as Label
		if label != null:
			label.add_theme_color_override("font_color", SEA_FOAM)
			label.add_theme_font_size_override("font_size", 18)


func _rounded_box(color: Color, radius: int) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.corner_radius_top_left = radius
	box.corner_radius_top_right = radius
	box.corner_radius_bottom_left = radius
	box.corner_radius_bottom_right = radius
	box.shadow_color = Color(0.0, 0.07, 0.12, 0.35)
	box.shadow_size = 7
	box.content_margin_left = 18.0
	box.content_margin_right = 18.0
	box.content_margin_top = 9.0
	box.content_margin_bottom = 9.0
	return box
