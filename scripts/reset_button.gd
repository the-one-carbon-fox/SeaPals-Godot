extends Button


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	visible = false



# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(_delta: float) -> void:
	pass


func _on_conditions_change_vis() -> void:
	visible = true
	

func _on_reset_button_pressed() -> void:
	visible = false
