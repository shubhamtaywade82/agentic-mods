# switchboard

Warns when two sessions edit the same file at once, lists current file claims, and sends a message to another session only when the person asks.

## Commands

- `/switchboard`

## Shared state

Keeps its values in the session store only.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
