# GameRules.gd - Core game logic and rule enforcement
extends Node

class_name GameRulesEngine

const DEFAULT_RP_BANK_CAP = 8
const DAMAGE_COUNTER_HP = 10
const DEFAULT_HAND_LIMIT = 10

# Dice utilities
func parse_die_expression(expression: String) -> Dictionary:
	var regex = RegEx.new()
	regex.compile("^D(\\d+)(?:\\s*([+-])\\s*(\\d+))?$")
	var match = regex.search(expression.to_upper())
	
	if not match:
		return {}
	
	var sides = int(match.strings[1])
	if not match.strings[2]:
		return {"sides": sides, "modifier": 0}
	
	var sign = match.strings[2]
	var amount = int(match.strings[3])
	var modifier = amount if sign == "+" else -amount
	
	return {"sides": sides, "modifier": modifier}

func roll_die(expression: String, random_func = randf) -> Dictionary:
	var die = parse_die_expression(expression)
	if die.is_empty():
		return {}
	
	var natural = randi() % die.sides + 1
	var total = maxi(0, natural + die.modifier)
	
	return {
		"expression": expression,
		"natural": natural,
		"modifier": die.modifier,
		"total": total
	}

# Resource management
func add_resource_within_cap(current: int, amount: int, cap: int) -> int:
	return mini(maxi(0, cap), maxi(0, current) + maxi(0, amount))

func apply_damage(current_health: int, damage: int) -> Dictionary:
	var health = maxi(0, current_health)
	var applied_damage = maxi(0, damage)
	var remaining_health = maxi(0, health - applied_damage)
	
	return {
		"applied_damage": applied_damage,
		"remaining_health": remaining_health,
		"destroyed": remaining_health == 0
	}

func calculate_victory_points(cards_in_play: Array) -> int:
	var total = 0
	for card in cards_in_play:
		if card:
			total += card.get("victory_points", 0)
			# Handle conditional victory points
			var bonus = card.get("bonus_victory_points", {})
			if bonus and bonus.get("type") == "perCardOnReef":
				var matching_count = cards_in_play.filter(func(c): return c.get("id") == bonus.get("target_card_id")).size()
				total += matching_count * bonus.get("amount", 0)
	return total

func determine_victory_result(player_vp: int, opponent_vp: int, target: int) -> Dictionary:
	var player = maxi(0, player_vp)
	var opponent = maxi(0, opponent_vp)
	var goal = maxi(1, target)
	
	if player < goal and opponent < goal:
		return {"winner": "none", "message": ""}
	
	if player >= goal and opponent >= goal:
		if player >= opponent:
			return {"winner": "player", "message": "Victory: You reached %d VP against opponent's %d VP." % [player, opponent]}
		else:
			return {"winner": "opponent", "message": "Defeat: Opponent reached %d VP against your %d VP." % [opponent, player]}
	
	if player >= goal:
		return {"winner": "player", "message": "Victory: You reached the %d VP target." % goal}
	else:
		return {"winner": "opponent", "message": "Defeat: Opponent reached the %d VP target." % goal}
