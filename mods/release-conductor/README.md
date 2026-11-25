# release-conductor

Assembles release readiness from the evidence, review, architecture, migration, dependency and performance states, plus a changelog, a rollback note and the deployment assets the repository lists. Checks only: it never deploys.

## Commands

| Command | What it does |
|---|---|
| `/release` | Release readiness: /release check |

## Hooks

`command.run`, `session.start`.

## Depends on

`evidence-gate`, `change-contract`, `review-tracker`, `architecture-guard`, `migration-sentinel`, `dependency-radar`, `performance-budget`

## Install

```
/plugin install release-conductor --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/release-conductor` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
