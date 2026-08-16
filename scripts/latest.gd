extends Label

func rand(min: int, max: int) -> int:
	var n = randi_range(min, max)
	return n



func _on_flip_pressed() -> void:
	if (rand(1,2) == 1):
		text = "Latest Flip: Heads"
	else:
		text = "Latest Flip: Tails"
