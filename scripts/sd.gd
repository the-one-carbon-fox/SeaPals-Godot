extends Label


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.



func _on_s_slider_value_changed(value: float) -> void:
	text = str(value) + "/500\n" + "     SD"
