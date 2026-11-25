# architecture-guard

Checks imports in edited TypeScript, JavaScript and Java files against the layer rules in configuration. Existing violations in the baseline are grandfathered; only new ones are warned about or refused.

## Commands

- `/architecture`

## Shared state

Publishes `status` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
