# migration-sentinel

Reviews SQL migration edits for destructive and table-locking changes, records the verdict for release readiness, and never executes SQL.

## Commands

- `/migration`

## Shared state

Publishes `status` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
