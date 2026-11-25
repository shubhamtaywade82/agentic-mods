# change-contract

Holds the task's objective, allowed and forbidden paths. Writes outside the contract are warned about or refused, according to its mode.

## Commands

- `/contract`

## Shared state

Publishes `status` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
