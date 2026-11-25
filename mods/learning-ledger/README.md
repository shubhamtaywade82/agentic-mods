# learning-ledger

Keeps repository lessons as reviewable records. A lesson is proposed, then approved by the person, and goes stale when a file it cites changes.

## Commands

- `/lesson`

## Shared state

Keeps its values in the session store only.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
