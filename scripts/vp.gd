extends Label

func _on_v_slider_value_changed(value: float) -> void:
	text = "VP\n" + str(value) + "/30"
