extends Label

func rand(minin: int, maxin: int) -> int:
	var n = randi_range(minin, maxin)
	return n



func _on_flip_pressed() -> void:
	if (rand(1,2) == 1):
		text = "Latest Flip: Heads"
	else:
		text = "Latest Flip: Tails"
