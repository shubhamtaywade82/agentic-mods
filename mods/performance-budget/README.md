# performance-budget

Compares measurements from benchmark and bundle-size reports against the budgets in .agentic-mods/budgets.json. A missing measurement is UNKNOWN, never a pass.

## Commands

- `/perf`

## Shared state

Publishes `status` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
