# markdown-preview

Renders a Markdown file from the repository in a pane, so READMEs, ADRs and reports can be read without leaving the session.

## Commands

- `/preview`

## Shared state

Publishes `document` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
