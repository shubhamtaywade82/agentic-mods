# behavior-lock

Captures the exported surface of TypeScript or JavaScript files before a refactoring, then compares it afterwards. Removed or changed exports fail the gate; added exports are reported as additive. The surface is read as text, not type-checked.

## Commands

- `/lock`

## Shared state

Publishes `gate` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
