# code-pet

A small status creature above the prompt whose mood follows the evidence state and how much tool activity the turn has had. It reads evidence-gate's published state and changes nothing.

## Commands

This mod registers no commands; it acts through hooks and the status line.

## Shared state

Publishes `mood` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
