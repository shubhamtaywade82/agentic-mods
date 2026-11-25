# test-impact

Maps changed JavaScript and TypeScript files to the tests that import them, flags changed code that no test reaches, and recommends the full suite for shared configuration. It selects tests and never runs them.

## Commands

- `/impact`

## Shared state

Publishes `impact` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
