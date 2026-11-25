# Architecture

## Layers

```
packages/core        pure TypeScript, no runtime dependencies; bundled into every mod
packages/tooling     Node scripts: engine declarations, typecheck, build, validate, deploy, registry
mods/<name>/         one plugin per mod: manifest, hooks manifest, source, bundled hooks module
workflows/, gates/   workflow and gate definitions as JSON, bundled into workflow-conductor
presets/             lists of mods per repository type
registry/            generated catalogue, unverified third-party list, compatibility record
```

A mod can import only its own files and the `claude-code` module. Shared logic therefore lives in
`packages/core` and is inlined by esbuild at build time. The build fails if any other import remains.

## State

Mods share values in three ways.

- `$.state` through atoms. The owning mod declares each published value in its `types/index.d.ts`
  under `PluginState`. Other mods read it by the same `{ plugin, key }` reference and list the owner
  under `dependencies`. Current publishers: evidence-gate, change-contract, test-impact,
  review-tracker, architecture-guard, migration-sentinel, dependency-radar, performance-budget,
  incident-timeline, and the gate mods (`gate` key: specification-guard, change-planner,
  regression-orchestrator, tdd-conductor, defect-protocol, behavior-lock,
  contract-compatibility-guard, observability-verifier, release-conductor).
- `$.store`, kept per plugin across sessions (session counters, the TDD phase, the active workflow run).
- Files under `.agentic-mods/`, written only through `stateRelativePath`:
  `config.json` (read), `contract.json`, `findings.json`, `ledger.json`, `plan.json`,
  `tdd.json` (read), `regression.json` (read), `compat.json` (read), `observability.json` (read),
  `budgets.json` (read), `release.json` (read), `architecture-baseline.json`, `behavior/<name>.json`,
  `tasks/<task>/…`, `incidents/…`, `audit/…`.

## Workflow model

`workflow-conductor` owns a run. A stage advances only if its gate's facts are all `PASS`.
Facts are derived from the published states, so the conductor never trusts a mod's own claim of
success beyond its published verdict. An approved deferral changes missing facts to `DEFERRED` for
that gate only. A `FAIL` is never deferred. The engine is in `packages/core/src/workflow.ts`;
the definitions are `workflows/*.json` and `gates/gates.json`.

## Decisions that shaped the design

- **Evidence comes from runs, not observation.** The engine's Bash result type declares only
  `stdout` and `stderr`. `evidence-gate` runs configured argv itself and reads the exit code.
- **Gates attach to actions.** A turn's completion cannot be refused, so the gate sits on
  `git commit`, `git push` and `gh pr create`.
- **Fail closed.** Guards register `.catch` handlers that deny when a judgement does not complete.
- **Native mods are trusted; others are checked.** The firewall consults `NATIVE_MODS`.
- **Readiness has one definition.** `assessReadiness` in core is used by pr-readiness,
  release-conductor and the cockpit.

## agentic-sdlc-kit integration

The sibling repository `shubhamtaywade82/agentic-sdlc-kit` is the runtime-independent SDLC engine.
This repository is the Claude Code distribution and UX layer. Dependency direction: the kit never
depends on this repository.

What is vendored today (`plugins/`, pinned in `plugins/PROVENANCE.json`, synced by
`packages/tooling/sync-sdlc-kit.mjs`):

- `sdlc-guard` — destructive-command governance (fail-closed approval).
- `secret-guard` — secret detection in writes, staged diffs and tool output.
- `model-router` — suggest-only model and effort routing for subagents.
- `run-observer` — bounded run telemetry, stored locally.

These are real Claude Code function-hook mods built against the same engine declarations. They pass
`claude plugin validate`. Their tests are kept in the kit repository and are not run here.

What is not yet shared:

- The kit's workflow, TDD and planning engines (`packages/core` in the kit) are not used by this
  repository. `workflow-conductor` and `tdd-conductor` reimplement the same ideas in the pure core
  here. Migrating them to the kit's contracts is the next integration step.
- The kit's `mod-sdk` helper names differ from the planning notes (there is no `defineMod`); any
  bridge must use the names the package actually exports.

Overlap decision: `sdlc-guard` and `secret-guard` replace `command-guard` in every preset, because
two mods gating the same Bash calls would ask the person twice. `command-guard` remains in the repo
for repositories that do not install the kit's plugins.
