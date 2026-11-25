# worktree-orchestrator

Lists git worktrees with their branches and uncommitted changes, and reports files that are changed in more than one worktree. Read-only: it never creates, removes or merges worktrees.

## Commands

- `/worktrees`

## Shared state

Keeps its values in the session store only.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
