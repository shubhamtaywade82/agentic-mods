# defect-protocol

Tracks a defect from symptom to root cause to fix and regression test. A defect counts as reproduced only with a reproduction or a documented reason it cannot be reproduced. Publishes the defect gate.

## Commands

- `/defect`

## Shared state

Publishes `gate`, `defect` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
