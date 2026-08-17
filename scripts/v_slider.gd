extends VSlider


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(_delta: float) -> void:
	pass


func _on_v_pdown_pressed() -> void:
	value -= 1


func _on_v_pup_pressed() -> void:
	value += 1
