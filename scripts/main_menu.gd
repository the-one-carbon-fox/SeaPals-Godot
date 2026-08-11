extends Node2D

const SEA_DEEP := Color(0.024, 0.196, 0.298, 1.0)
const SEA_MID := Color(0.039, 0.435, 0.561, 1.0)
const SEA_FOAM := Color(0.843, 1.0, 0.969, 1.0)
const CORAL := Color(1.0, 0.498, 0.431, 1.0)
const GOLD := Color(1.0, 0.82, 0.4, 1.0)

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
	background.color = SEA_DEEP
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

	for i in range(6):
		var bubble := Label.new()
		bubble.name = "Bubble%d" % i
		bubble.text = "○"
		bubble.add_theme_color_override("font_color", Color(SEA_FOAM.r, SEA_FOAM.g, SEA_FOAM.b, 0.32))
		bubble.add_theme_font_size_override("font_size", 34 + i * 4)
		bubble.position = Vector2(105.0 + i * 180.0, 95.0 + (i % 3) * 96.0)
		bubble.z_index = -20
		add_child(bubble)

	var title := Label.new()
	title.name = "Title"
	title.text = "SeaPals"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_color_override("font_color", SEA_FOAM)
	title.add_theme_color_override("font_shadow_color", Color(0.0, 0.1, 0.18, 0.8))
	title.add_theme_constant_override("shadow_offset_x", 4)
	title.add_theme_constant_override("shadow_offset_y", 5)
	title.add_theme_font_size_override("font_size", 86)
	title.position = Vector2(340.0, 132.0)
	title.size = Vector2(600.0, 110.0)
	add_child(title)

	var subtitle := Label.new()
	subtitle.name = "Subtitle"
	subtitle.text = "Build your reef, draw the tides, and keep your ocean thriving."
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.add_theme_color_override("font_color", Color(GOLD.r, GOLD.g, GOLD.b, 0.95))
	subtitle.add_theme_font_size_override("font_size", 24)
	subtitle.position = Vector2(300.0, 248.0)
	subtitle.size = Vector2(680.0, 44.0)
	add_child(subtitle)


func _style_menu_controls() -> void:
	var start_button := $Start as Button
	start_button.position = Vector2(505.0, 360.0)
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
