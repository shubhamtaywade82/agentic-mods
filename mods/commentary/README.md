# commentary

A one-line commentary above the prompt about the latest tool activity, in a sportscaster or monologue voice, chosen with /commentary. Templated: it makes no model calls.

## Commands

- `/commentary`

## Shared state

Publishes `voice`, `latest` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
