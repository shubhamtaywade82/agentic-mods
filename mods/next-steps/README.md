# next-steps

After a turn that changed files, offers up to three suggested next prompts in a row above the prompt. Taking one puts it in the prompt box for editing.

## Commands

- `/next-steps`

## Shared state

Publishes `steps` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
