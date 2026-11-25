# review-tracker

Turns review findings into tracked records with a lifecycle and a required reason or evidence at each resolution. Unresolved high-severity findings fail the review gate.

## Commands

- `/finding`

## Shared state

Publishes `gate` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
