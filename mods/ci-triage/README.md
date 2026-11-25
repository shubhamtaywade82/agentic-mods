# ci-triage

Classifies a CI failure log (compilation, unit, integration, flaky, infrastructure, credentials, lint, security, performance) and recommends the next action. It stops the loop when the cause is infrastructure or credentials, because more code edits cannot fix those.

## Commands

- `/ci`

## Shared state

Keeps its values in the session store only.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
