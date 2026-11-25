# pr-readiness

Combines scope, evidence, review and architecture into one readiness verdict, and drafts a pull-request verification section from recorded results only.

## Commands

- `/pr-ready`

## Shared state

Keeps its values in the session store only.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
