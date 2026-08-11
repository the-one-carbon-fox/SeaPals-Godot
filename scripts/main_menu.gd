extends Node2D

const SEA_DEEP := Color(0.024, 0.196, 0.298, 1.0)
const SEA_MID := Color(0.039, 0.435, 0.561, 1.0)
const SEA_FOAM := Color(0.843, 1.0, 0.969, 1.0)
const CORAL := Color(1.0, 0.498, 0.431, 1.0)
const GOLD := Color(1.0, 0.82, 0.4, 1.0)
const LOGO_TEXTURE := preload("res://assets/Images/ui/searealm_logo.svg")

func _ready() -> void:
	_build_ocean_backdrop()
	_style_menu_controls()


func _process(_delta: float) -> void:
	pass


func _on_button_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/conditions.tscn")


func _build_ocean_backdrop() -> void:
	var background := ColorRect.new()
	background.name = "OceanBackdrop"
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	background.offset_right = 1280.0
	background.offset_bottom = 720.0
	background.color = Color(0.005, 0.06, 0.1, 1.0)
	background.z_index = -30
	add_child(background)
	move_child(background, 0)

	var glow := ColorRect.new()
	glow.name = "LagoonGlow"
	glow.position = Vector2(0.0, 0.0)
	glow.size = Vector2(1280.0, 720.0)
	glow.color = SEA_MID.darkened(0.05).lerp(Color(SEA_MID.r, SEA_MID.g, SEA_MID.b, 0.35), 1.0)
	glow.z_index = -29
	add_child(glow)
	move_child(glow, 1)

	for wave_index in range(3):
		var wave := Polygon2D.new()
		wave.name = "SurfaceWave%d" % wave_index
		var wave_colors := [
			Color(0.0, 0.57, 0.9, 0.32),
			Color(0.0, 0.34, 0.95, 0.26),
			Color(0.68, 0.96, 1.0, 0.18),
		]
		wave.color = wave_colors[wave_index]
		var y := 500.0 + wave_index * 54.0
		wave.polygon = PackedVector2Array([
			Vector2(0.0, y),
			Vector2(220.0, y - 35.0),
			Vector2(430.0, y + 10.0),
			Vector2(650.0, y - 40.0),
			Vector2(900.0, y + 14.0),
			Vector2(1280.0, y - 32.0),
			Vector2(1280.0, 720.0),
			Vector2(0.0, 720.0),
		])
		wave.z_index = -25 + wave_index
		add_child(wave)

	for i in range(10):
		var bubble := Label.new()
		bubble.name = "Bubble%d" % i
		bubble.text = "○"
		bubble.add_theme_color_override("font_color", Color(SEA_FOAM.r, SEA_FOAM.g, SEA_FOAM.b, 0.32))
		bubble.add_theme_font_size_override("font_size", 34 + i * 4)
		bubble.position = Vector2(80.0 + i * 125.0, 80.0 + (i % 4) * 76.0)
		bubble.z_index = -20
		add_child(bubble)

	var logo := TextureRect.new()
	logo.name = "SeaRealmLogo"
	logo.texture = LOGO_TEXTURE
	logo.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.position = Vector2(120.0, 78.0)
	logo.size = Vector2(1040.0, 210.0)
	add_child(logo)

	var subtitle := Label.new()
	subtitle.name = "Subtitle"
	subtitle.text = "Build your reef, draw the tides, and keep your ocean thriving."
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.add_theme_color_override("font_color", Color(GOLD.r, GOLD.g, GOLD.b, 0.95))
	subtitle.add_theme_font_size_override("font_size", 24)
	subtitle.position = Vector2(300.0, 292.0)
	subtitle.size = Vector2(680.0, 44.0)
	add_child(subtitle)


func _style_menu_controls() -> void:
	var start_button := $Start as Button
	start_button.position = Vector2(505.0, 398.0)
	start_button.size = Vector2(270.0, 68.0)
	start_button.text = "Start Expedition"
	start_button.add_theme_font_size_override("font_size", 27)
	start_button.add_theme_color_override("font_color", Color(0.027, 0.141, 0.208, 1.0))
	start_button.add_theme_stylebox_override("normal", _rounded_box(CORAL, 18))
	start_button.add_theme_stylebox_override("hover", _rounded_box(GOLD, 18))
	start_button.add_theme_stylebox_override("pressed", _rounded_box(Color(0.914, 0.427, 0.376, 1.0), 18))

	var link_button := $LinkButton as LinkButton
	link_button.position = Vector2(455.0, 615.0)
	link_button.size = Vector2(370.0, 44.0)
	link_button.text = "Dive into the open-source repo"
	link_button.add_theme_font_size_override("font_size", 20)
	link_button.add_theme_color_override("font_color", SEA_FOAM)


func _rounded_box(color: Color, radius: int) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.corner_radius_top_left = radius
	box.corner_radius_top_right = radius
	box.corner_radius_bottom_left = radius
	box.corner_radius_bottom_right = radius
	box.shadow_color = Color(0.0, 0.07, 0.12, 0.35)
	box.shadow_size = 8
	box.content_margin_left = 18.0
	box.content_margin_right = 18.0
	box.content_margin_top = 10.0
	box.content_margin_bottom = 10.0
	return box
