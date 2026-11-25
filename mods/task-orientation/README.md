# task-orientation

Keeps the goal, current task, blocker and next step visible in a pane, captured from the first prompt and set with commands.

## Commands

- `/orient-blocker`
- `/orient-goal`
- `/orient-next`
- `/orient-show`
- `/orient-task`

## Shared state

Publishes `orientation` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
