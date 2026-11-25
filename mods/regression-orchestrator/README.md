# regression-orchestrator

Scores the regression risk of the working tree, explains the score, and runs the configured scope for its level. Publishes the regression gate. Commands are configured per repository in .agentic-mods/regression.json.

## Commands

- `/regression`

## Shared state

Publishes `gate` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
