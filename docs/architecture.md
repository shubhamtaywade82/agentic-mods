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
