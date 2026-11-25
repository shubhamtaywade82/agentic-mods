# Changelog

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
