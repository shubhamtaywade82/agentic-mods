# Changelog

## Unreleased

Fixes from the review of the full catalog. Each fix has a test under the mod's `tests/`.

### Fixed

- `review-tracker`: an unreadable `findings.json` read as "no findings", so the next `/finding add`
  overwrote every recorded finding. It is now reported and left untouched; the gate is rebuilt from
  the file at session start.
- `verify`: `/verify-run` ran its text through `bash -c`, ignored the exit code, and checked for the
  task's first word. It now runs argv without a shell and passes only on exit 0.
- `trace`: every finished tool was re-closed as cancelled at the end of the turn, and subagents never
  closed. Tools keep their status, subagents close on their own `turn.complete`, nodes get a duration.
- `test-impact`: new untracked files were never reported as untested, an edited test was never
  selected, and a failing `git status` read as "nothing changed".
- `tdd-conductor` / `workflow-conductor`: `/tdd green` during REFACTOR was rejected, so the refactor
  gate could never pass. It now verifies the refactor. NotebookEdit is gated like Edit and Write, the
  exception log appends, and a test path starting with `-` is refused.
- `release-conductor`: a changelog committed since the last tag counts as updated; paths in
  `release.json` outside the repository are refused instead of probed.
- `sdlc`: prompts pointed at skill files the mod does not ship; they are now self-contained.
- `session-wrapped` and `response-modes`: counters and the chosen style leaked into later sessions.
- `session-meter`: a crossed threshold toasted on every measurement; it now toasts once per crossing.
- `worktree-orchestrator`: a failed `git status` showed as "0 uncommitted"; it now says unknown.
- `pr-readiness`: the pane said "Release readiness". README paths now point at `src/`.
- `observability-verifier`, `performance-budget`, `regression-orchestrator`: a malformed config file
  read as "nothing configured". It is now reported as invalid JSON (shared `readJsonFile` in core).
- `next-steps`: denied or failed edits counted as changes; only edits that ran count now.
- `regression-orchestrator`: dropped a stored assessment that nothing read.

### Added

- `pnpm smoke:live`: loads each mod with its dependencies into a headless Claude Code session in a
  throwaway repository, runs every command it registers, and fails when the hooks module did not
  load, a hook was skipped, or a command answered nothing. Commands answered by mods need no model
  call.

## 0.2.0 — production candidate

Hardening after the first full build. Verified by `pnpm check` (typecheck, build, lint, engine validation,
command-name checks, registry). Not yet exercised in a live session beyond load and hot reload.

### Fixed

- `task-orientation` used `/goal`, a built-in; its session hook was skipped. Commands are now `orient-*`.
- `change-planner` used `/plan` and `mission-control` used `/agents`: both built-ins. Now `/change-plan` and `/subagents`.
- `next-steps` registered `/next-steps` without a handler; it now answers.
- `evidence-gate` refused every commit when no evidence commands were configured. Without commands it now
  warns and says so; with commands it enforces `gateMode`.
- Command handlers that read files or run processes now report the failure instead of throwing.
- `cache-clock` countdown timer is cancelled on session end.

### Changed

- `command-guard` refuses shell commands that read or copy protected files (`cat .env`, `cp id_rsa …`).
- `turn-replay` keeps at most 60 lines of 200 characters per change, to bound state size.
- Validation fails if a command shadows a built-in, or a registered command has no handler.
- `pnpm check` runs the full release gate in order.
- Every native mod has a generated README and version 0.2.0.

### Known gaps

- No automated tests yet.
- TypeScript lint is off: typescript-eslint 8.74 does not support TypeScript 7.0.
- Built-in command list is best-effort; session refusal notices are the authority.
- Interpreter-based reads of secret files (`python -c open(...)`) are not detected.

## 0.1.0 — first build

- 40 native mods, shared core, tooling, presets, registry and marketplace.
- Vendored runtime plugins from agentic-sdlc-kit at commit 2094bac.
