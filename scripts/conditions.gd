extends Node2D

signal condition_drawn(condition_name: String)
signal _reset()

var events: Array[String] = []

const SEA_DEEP := Color(0.024, 0.157, 0.239, 1.0)
const SEA_PANEL := Color(0.043, 0.365, 0.459, 1.0)
const SEA_FOAM := Color(0.843, 1.0, 0.969, 1.0)
const CORAL := Color(1.0, 0.498, 0.431, 1.0)
const GOLD := Color(1.0, 0.82, 0.4, 1.0)
const LOGO_TEXTURE := preload("res://assets/Images/ui/searealm_logo.svg")

func _ready() -> void:
	load_conditions()


func load_conditions() -> void:
	var path: String = "res://assets/Conditions-Deck/default.json"
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)

	if file == null:
		push_error("Could not open JSON file at: " + path)
		return

	var json_text: String = file.get_as_text()
	var data: Variant = JSON.parse_string(json_text)

	if typeof(data) != TYPE_DICTIONARY or not data.has("events"):
		push_error("JSON format error: missing 'events' array")
		return

	# Convert Variant array → typed Array[String]
	var raw_events: Array = data["events"]
	events = []
	for e in raw_events:
		events.append(String(e))

	print("Loaded", events.size(), "condition cards.")
	


func pick_random_condition() -> String:
	if events.is_empty():
		push_error("No events loaded!")
		return ""

	var index: int = randi() % events.size()
	return events[index]


func _on_draw_pressed() -> void:
	if events.is_empty():
		emit_signal("condition_drawn","OOC")
		_reset_deck()
		return

	var index: int = randi() % events.size()
	var condition: String = events[index]

	# Remove the card so it cannot be drawn again
	events.remove_at(index)

	print("Drew condition:", condition)
	emit_signal("condition_drawn", condition)

func _reset_deck() -> void:
	load_conditions()
	print("Deck reset!")
	emit_signal("_reset")
