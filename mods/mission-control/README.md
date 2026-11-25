# mission-control

Shows subagents as a tree: what each is doing, which files it touched, its tool calls, and a plain-language line per agent. Review agents are flagged. Templated from events, with no model calls.

## Commands

- `/subagents`

## Shared state

Publishes `agents` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
