# debug-timeline

Records the commands run during debugging, the hypotheses proposed and their outcomes, and flags repeated commands so circular investigation is visible.

## Commands

- `/hypothesis`
- `/result`
- `/timeline`

## Shared state

Publishes `timeline` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
