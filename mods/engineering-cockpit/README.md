# engineering-cockpit

One pane with the verification state of the change: contract, impact, evidence, review, architecture, migration, dependencies, performance and release readiness. It reads what the other mods publish and changes nothing.

## Commands

| Command | What it does |
|---|---|
| `/agentic` | Cockpit: /agentic status | doctor | privacy |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Depends on

`evidence-gate`, `change-contract`, `test-impact`, `review-tracker`, `architecture-guard`, `migration-sentinel`, `dependency-radar`, `performance-budget`

## Install

```
/plugin install engineering-cockpit --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/engineering-cockpit` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
