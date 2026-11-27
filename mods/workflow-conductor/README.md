# workflow-conductor

Runs delivery workflows. Two are owned by the Agentic SDLC Kit: `feature-development` (the kit's TDD feature loop) and `bug-fix` (the kit's fix loop). For those, the kit keeps the run, its phases and its evidence. This mod asks the kit what is next and runs the phase command the kit names. The other workflows (regression, refactoring, pull request, release, hotfix, incident, TDD) still run on this mod's own stage engine, where a stage advances only when its gate's evidence is current or an approved deferral is recorded. Artifacts and the decision log are written under `.agentic-mods/tasks`.

## Kit-backed workflows

These need the kit CLI on PATH: `npm install -g @agentic-sdlc-kit/cli`. Without it, `/workflow start` is refused with that command.

- `/workflow start feature-development <id>` runs `kit feature <id> start`. The kit needs `docs/specifications/features/<id>/SPEC.md` and `docs/plans/<id>/plan.json` first.
- `/workflow start bug-fix <id>` runs `kit fix <id> start`, under the same rules.
- `/workflow status` shows the kit's next action: the phase it waits for and the command that checks it.
- `/workflow advance` runs the phase the kit names, as argv built from the kit's structured answer. Before a phase that executes verification, every verification command in `plan.json` is checked against the process policy. A denied or unreadable plan is refused, and no phase runs.
- `/workflow defer` and `/workflow cancel` are refused for a kit run. The kit's evidence gate decides when a phase passes, and the kit owns the run state.

This mod keeps one pointer in its store: the workflow id and the run id. It keeps no other run state.

## Commands

- `/decision`
- `/record`
- `/workflow`

## Shared state

Publishes `conductor` for other mods and the engineering cockpit.

## Configuration

Reads `.agentic-mods/config.json` when relevant. Invalid fields are reported by `/agentic doctor` and replaced by defaults. See the repository README for the schema.

## Install

```
/plugin install workflow-conductor --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what this one calls with `claude plugin validate mods/workflow-conductor` before loading it.

## Status

Version 0.2.0. Built from the shared core with the engine declarations for Claude Code 2.1.332. Covered by `claude plugin test` (`tests/commands.test.ts`, `tests/gates.test.ts`, `tests/kit-bridge.test.ts`, `tests/render.test.tsx`).

This README is hand-written: it describes the kit path, which the generated listing cannot. Keep the Status line in step with `tests/`.
