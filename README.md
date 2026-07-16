# SeaPals TCG - Godot Implementation

### THIS IS NOT FINISHED AND HAS QUITE A FEW BUGS!

A complete port of the SeaPals Trading Card Game simulator to Godot Engine.

## Engine Version

This project targets **Godot 4.7** using the GL Compatibility renderer.

## Project Structure

```
project/
├── scenes/
│   ├── systems/          # Core game systems
│   │   ├── CardDatabase.gd
│   │   ├── GameState.gd
│   │   └── GameRules.gd
│   ├── MainMenu.tscn/gd  # Main menu scene
│   ├── GameBoard.tscn/gd # Main game board scene
│   ├── cards/            # Card related scenes
│   └── components/       # Reusable UI components
├── data/
│   └── cards/            # Card data JSON files
├── styles/               # Theme styles
└── project.godot         # Project configuration
```

## Features Implemented

### Core Systems
- ✅ Card Database system with card lookups
- ✅ Game State management (rounds, turns, phases)
- ✅ Game Rules engine (dice rolls, damage, resources)
- ✅ Main game board UI layout
- ✅ Card instance system

### In Progress
- Deck building and setup
- Hand management
- Play card mechanics
- Attack resolution
- Opponent AI
- Victory condition checking

## Development Notes

This implementation uses GDScript for game logic and Godot's built-in UI system (Control nodes) for rendering.

## Testing

Run the project with Godot 4.7 to launch the main menu. From a local install with the CLI available, use `godot --path .` from the repository root.
