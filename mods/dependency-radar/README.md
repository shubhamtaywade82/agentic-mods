# dependency-radar

Diffs direct dependencies when a manifest or lockfile is edited (added, removed, major-version changes), and reads scanner results saved under .agentic-mods/scans. It never contacts the network.

## Commands

- `/radar`

## Shared state

Publishes `status` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Not covered by automated tests yet.
