# pr-readiness

Combines scope, evidence, review and architecture into one readiness verdict, and drafts a pull-request verification section from recorded results only.

## Commands

| Command | What it does |
|---|---|
| `/pr-ready` | Readiness verdict for the change; /pr-ready description drafts the PR verification section |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Depends on

`evidence-gate`, `change-contract`, `review-tracker`, `architecture-guard`

## Install

```
/plugin install pr-readiness --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/pr-readiness` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
