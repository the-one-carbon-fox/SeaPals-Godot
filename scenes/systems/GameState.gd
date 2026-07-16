# GameState.gd - Manages game state and turn progression
extends Node

class_name GameStateManager

enum GamePhase {
	SETUP,
	TURN_START,
	CHOOSE_OR_DRAW,
	COLLECT_RP,
	ACTION_PHASE,
	TURN_END,
	VICTORY,
	DEFEAT
}

enum PlayerTurn {
	PLAYER,
	OPPONENT
}

class GameBoard:
	var current_round: int = 0
	var current_turn: int = 0
	var current_phase: int = GamePhase.SETUP
	var current_player_turn: int = PlayerTurn.PLAYER
	
	var player_rp: int = 0
	var player_rp_bank: int = 0
	var player_rp_bank_cap: int = 8
	var player_vp: int = 0
	
	var opponent_rp: int = 0
	var opponent_rp_bank: int = 0
	var opponent_rp_bank_cap: int = 8
	var opponent_vp: int = 0
	
	var player_hand: Array = []
	var player_deck: Array = []
	var player_discard: Array = []
	var player_board: Dictionary = {}  # foundation instances
	
	var opponent_hand: Array = []
	var opponent_deck: Array = []
	var opponent_discard: Array = []
	var opponent_board: Dictionary = {}
	
	var active_condition: Dictionary = {}
	var victory_target: int = 30

var board: GameBoard

func _ready():
	board = GameBoard.new()

func start_new_game():
	board = GameBoard.new()
	board.current_phase = GamePhase.SETUP

func start_turn():
	board.current_turn += 1
	board.current_phase = GamePhase.TURN_START

func next_phase():
	var phases = [
		GamePhase.TURN_START,
		GamePhase.CHOOSE_OR_DRAW,
		GamePhase.COLLECT_RP,
		GamePhase.ACTION_PHASE,
		GamePhase.TURN_END
	]
	
	var current_index = phases.find(board.current_phase)
	if current_index >= 0 and current_index < phases.size() - 1:
		board.current_phase = phases[current_index + 1]

func switch_turn():
	if board.current_player_turn == PlayerTurn.PLAYER:
		board.current_player_turn = PlayerTurn.OPPONENT
	else:
		board.current_player_turn = PlayerTurn.PLAYER
		board.current_round += 1

func is_player_turn() -> bool:
	return board.current_player_turn == PlayerTurn.PLAYER
