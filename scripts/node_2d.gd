extends Sprite2D

func _ready() -> void:
	centered = true
	rotation_degrees = -90.0
	scale = Vector2(0.48, 0.48)
	var root := get_parent()   # this is the "conditions" node

	if root:
		root.condition_drawn.connect(_on_condition_drawn)
	else:
		push_error("Root node not found!")


func _on_condition_drawn(condition_name: String) -> void:
	change_skin(condition_name)


func change_skin(condition_name: String) -> void:
	var path := "res://assets/Images/images/cards/Conditions/%s.png" % condition_name

	if ResourceLoader.exists(path):
		texture = load(path)
		rotation_degrees = -90.0
	else:
		push_error("Missing skin texture for: " + condition_name)
