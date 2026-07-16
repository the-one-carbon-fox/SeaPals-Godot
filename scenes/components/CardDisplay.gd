# CardDisplay.gd - Renders a card visually
extends PanelContainer

var card_instance: CardInstance

func _ready():
	add_theme_stylebox_override("panel", preload("res://styles/card_style.tres"))

func display_card(card: CardInstance):
	card_instance = card
	update_display()

func update_display():
	if not card_instance:
		return
	
	var card_data = card_instance.card_data
	
	# Clear children
	for child in get_children():
		child.queue_free()
	
	# Build card display
	var vbox = VBoxContainer.new()
	add_child(vbox)
	
	# Name
	var name_label = Label.new()
	name_label.text = card_data.get("name", "Unknown")
	name_label.add_theme_font_size_override("font_size", 12)
	vbox.add_child(name_label)
	
	# Cost
	var cost_label = Label.new()
	var cost = card_data.get("cost", {})
	cost_label.text = "Cost: %d RP" % cost.get("rp", 0)
	cost_label.add_theme_font_size_override("font_size", 10)
	vbox.add_child(cost_label)
	
	# Health (if applicable)
	if card_data.get("health"):
		var health_label = Label.new()
		health_label.text = "HP: %d/%d" % [card_instance.current_health, card_instance.max_health]
		health_label.add_theme_font_size_override("font_size", 10)
		vbox.add_child(health_label)
	
	# Victory Points
	if card_data.get("victory_points", 0) > 0:
		var vp_label = Label.new()
		vp_label.text = "VP: %d" % card_data.get("victory_points", 0)
		vp_label.add_theme_font_size_override("font_size", 10)
		vbox.add_child(vp_label)
