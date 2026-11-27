# Changelog

## Unreleased

### Added

- README install guide for users: add the marketplace, install a mod or a whole preset, update and
  uninstall. Verified from GitHub into a clean Claude Code config: a mod installs, loads and answers
  its command, `engineering-cockpit` brings its eight dependencies, and the `essential` preset
  installs all 13 plugins.

### Fixed

- `verify`: `/verify-run` runs only the commands declared under `evidence.commands` in
  `.agentic-mods/config.json`. Before, it executed any text typed after the command through
  `$.process.run`, outside the Bash guards. Declared commands pass the process policy, run once, and
  are not retried. Model and effort escalation never reached the executor, so it is removed.
- `mod-firewall`: the destructive-operation policy applies to every process launch except the
  engine's own. Trusting a native mod exempts it from the allowlist, never from that policy. The policy
  reuses the sdlc-guard classifier vendored from agentic-sdlc-kit.
- Workflow gates fail closed. A stage whose gate is missing from the catalogue blocks the transition,
  and a gate with no facts never passes. Lookups use the catalogue's own keys, so `constructor` is not a
  gate. A catalogue that fails validation refuses start, advance and defer, and reports every problem.
- CI: the offline release gate runs on every pull request: build from source, drift check on committed
  bundles and registry, unit tests, lint, validate. Before, CI ran only an 8-mod stub typecheck.

### Added

- Unit tests for `packages/core` (`pnpm test:core`, 22 cases): process policy and argv quoting, workflow
  gate failure modes, the shipped workflow and gate catalogues, and declared-check verification.
- Behaviour tests through the engine hooks, 25 cases: `verify` runs only declared checks, once, and
  refuses destructive or undeclared ones (`verify/tests/declared-checks.test.ts`); `command-guard` refuses
  always-block commands and secret-file reads and holds confirm-level commands for approval
  (`command-guard/tests/guard-behaviour.test.ts`); `guardian` refuses a write that carries a secret and
  redacts secrets in results (`guardian/tests/secret-hooks.test.ts`); `workflow-conductor` will not
  advance past an unmet gate and refuses unknown workflows and stages (`workflow-conductor/tests/gates.test.ts`).
  Disabling the guard in each case makes its tests fail.

### Design

- One look across the catalog: `packages/core/src/ui.tsx` holds the palette (theme keys, so colors
  follow the person's theme), the glyphs (✓ ✗ ○ ● ▲ ⊘) and the blocks every surface is built from:
  title rows with verdict chips, bordered state cards, meters, one-line bands and empty states
  that name the command to run.
- Every pane is rebuilt on it: mission-control (agent cards, files touched, a live band while
  agents run), trace (a connector-drawn tree with durations, in a pane), engineering-cockpit (gate
  chips and a gates-passing meter), workflow-conductor (a stage stepper), evidence-gate,
  review-tracker (finding cards by severity), test-impact, turn-replay (colored diff with
  previous/next), pr-readiness, task-orientation, debug-timeline, architecture-guard and
  markdown-preview. Every band above the prompt uses the same one-line form, and session-meter draws
  a context gauge.
- Each redesigned surface has a render test that mounts it on the terminal and the desktop app.

### Fixed

- Approval questions could appear twice for one command: guardian and command-guard each opened
  their own question. They now ask through Claude Code's permission dialog (`tool.check`), so guards
  that hold the same command share one dialog, and an ask nobody can answer is a deny.
  command-guard's typed-code tier still asks for its code. The vendored `sdlc-guard` asks on its
  own and then through the dialog as well; that needs a fix upstream in agentic-sdlc-kit.

### Fixed (from the manual live pass)

- Every preset left out some of its mods' dependencies; `engineering-cockpit` alone needs eight. A
  session started with `--plugin-dir` loads only the folders it is given and a mod with a missing
  dependency never loads, so the cockpit never loaded from a preset loaded that way. Presets now list their full dependency closure, and
  `pnpm registry` fails a preset that misses one.
- The README preset table was out of date; it now matches `presets/*.json`.
- guardian's README says to load one approval guard: guardian, `command-guard` and `sdlc-guard`
  together ask twice for the same command.

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

### Changed

- Found by the live smoke test: `/trace`, `/tdd` and `/release` are names that popular plugins and
  skills already own, and the engine refused them. They are now `/trace-tree`, `/tdd-cycle` and
  `/release-gate`.
- Every mod registers its commands through core's `registerCommand`. A refused name used to throw
  and skip the rest of `session.start`, losing the mod's other commands; it is now reported in a
  toast and the remaining commands still register.

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
