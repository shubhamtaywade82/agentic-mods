# engineering-cockpit

One pane with the verification state of the change: contract, impact, evidence, review, architecture, migration, dependencies, performance and release readiness. It reads what the other mods publish and changes nothing.

## Commands

- `/agentic`

## Shared state

Publishes `rows` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
