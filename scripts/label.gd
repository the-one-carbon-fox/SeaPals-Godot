extends Label


# Called when the node enters the scene tree for the first time.
func rand(min: int, max: int) -> int:
	var n = randi_range(min, max)
	return n





func _on_d_4_pressed() -> void:
	text = "Latest Outcome: " + str(rand(1,4)) + " From D4"


func _on_d_6_pressed() -> void:
	text = "Latest Outcome: " + str(rand(1,6)) + " From D6"



func _on_d_8_pressed() -> void:
	text = "Latest Outcome: " + str(rand(1,8)) + " From D8"



func _on_d_10_pressed() -> void:
	text = "Latest Outcome: " + str(rand(1,10)) + " From D10"



func _on_d_12_pressed() -> void:
	text = "Latest Outcome: " + str(rand(1,12)) + " From D12"



func _on_d_13_pressed() -> void:
	text = "Latest Outcome: " + str(rand(1,20)) + " From D20"
