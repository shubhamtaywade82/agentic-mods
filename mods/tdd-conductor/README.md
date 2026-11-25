# tdd-conductor

Runs the RED, GREEN and REFACTOR cycle. RED counts only when the test fails for a behavioral reason. Production edits are refused outside the implementation and refactor phases, unless an exception is recorded. Publishes the TDD gate.

## Commands

- `/tdd`

## Shared state

Publishes `gate` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
