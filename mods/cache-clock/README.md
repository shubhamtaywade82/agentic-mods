# cache-clock

Shows how long the prompt cache from the last turn is expected to stay warm. It only displays the estimate and never sends requests to keep it warm.

## Commands

This mod registers no commands; it acts through hooks and the status line.

## Shared state

Publishes `clock` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
