# CardInstance.gd - Represents a single card instance in play
extends Node

class_name CardInstance

var card_id: String
var instance_id: String
var card_data: Dictionary
var current_health: int
var max_health: int
var position_zone: String  # "hand", "reef", "deck", "discard", "orphan"
var owner_player: String  # "player" or "opponent"

func _init(card_id: String, instance_id: String, card_data: Dictionary = {}):
	self.card_id = card_id
	self.instance_id = instance_id
	self.card_data = card_data
	self.max_health = card_data.get("health", 0)
	self.current_health = max_health

func get_card_name() -> String:
	return card_data.get("name", "Unknown Card")

func get_cost() -> Dictionary:
	return card_data.get("cost", {"rp": 0})

func can_play(rp_available: int) -> bool:
	var rp_cost = get_cost().get("rp", 0)
	return rp_available >= rp_cost

func take_damage(amount: int) -> Dictionary:
	var result = GameRules.apply_damage(current_health, amount)
	current_health = result["remaining_health"]
	return result
