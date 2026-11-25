# session-wrapped

Counts the session's turns, tool calls and file edits, and shows a text summary with /wrapped. It does not create images and writes nothing to disk.

## Commands

- `/wrapped`

## Shared state

Keeps its values in the session store only.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
