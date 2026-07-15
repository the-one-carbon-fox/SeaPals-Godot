# GameBoard.gd - Main game board controller
extends Control

var state_manager: GameStateManager
var rules_engine: GameRulesEngine

func _ready():
	state_manager = get_node("/root/GameState") as GameStateManager
	rules_engine = get_node("/root/GameRules") as GameRulesEngine
	state_manager.start_new_game()
	update_ui()

func update_ui():
	var board = state_manager.board
	
	%RoundLabel.text = "Round: %d" % board.current_round
	%PlayerStatsLabel.text = "You: %d VP | %d/%d RP" % [board.player_vp, board.player_rp_bank, board.player_rp_bank_cap]
	%OpponentStatsLabel.text = "Opponent: %d VP | %d/%d RP" % [board.opponent_vp, board.opponent_rp_bank, board.opponent_rp_bank_cap]

func _on_end_turn_button_pressed():
	state_manager.next_phase()
	if state_manager.board.current_phase == GameStateManager.GamePhase.TURN_END:
		state_manager.switch_turn()
		state_manager.start_turn()
	update_ui()
