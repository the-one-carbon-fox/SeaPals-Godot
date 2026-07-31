extends VSlider


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.

func _on_s_dup_pressed() -> void:
	value += 10


func _on_s_ddown_pressed() -> void:
	value -= 10
