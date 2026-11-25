# release-conductor

Assembles release readiness from the evidence, review, architecture, migration, dependency and performance states, plus a changelog, a rollback note and the deployment assets the repository lists. Checks only: it never deploys.

## Commands

- `/release`

## Shared state

Publishes `gate` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
