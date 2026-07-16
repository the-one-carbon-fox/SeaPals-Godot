# CardDatabase.gd - Manages all card data and lookups
extends Node

var cards_by_id = {}
var cards_by_category = {}
var all_cards = []

func _ready():
	load_all_cards()

func load_all_cards():
	# Load card data from JSON files
	var card_files = [
		"res://data/cards/coral.json",
		"res://data/cards/creatures.json",
		"res://data/cards/support.json",
		"res://data/cards/habitats.json",
		"res://data/cards/conditions.json"
	]
	
	for file_path in card_files:
		if ResourceLoader.exists(file_path):
			var file = FileAccess.open(file_path, FileAccess.READ)
			if file:
				var json_data = JSON.parse_string(file.get_as_text())
				if json_data:
					for card in json_data:
						register_card(card)

func register_card(card_data: Dictionary):
	var card_id = card_data.get("id")
	if not card_id:
		return
	
	cards_by_id[card_id] = card_data
	all_cards.append(card_data)
	
	var category = card_data.get("category")
	if category:
		if category not in cards_by_category:
			cards_by_category[category] = []
		cards_by_category[category].append(card_data)

func get_card(card_id: String) -> Dictionary:
	return cards_by_id.get(card_id, {})

func get_cards_by_category(category: String) -> Array:
	return cards_by_category.get(category, [])

func get_cards_by_kind(kind: String) -> Array:
	return all_cards.filter(func(card): return card.get("kind") == kind)
