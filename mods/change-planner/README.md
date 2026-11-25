# change-planner

Records the change plan (objective, files, tests, risks) and turns it into a change contract. Publishes the plan gate for the delivery workflows.

## Commands

| Command        | What it does                              |
| -------------- | ----------------------------------------- |
| `/change-plan` | Change plan: /change-plan set <objective> | <files> | <tests> | <risks>, /change-plan show, /change-plan contract |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install change-planner --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/change-planner` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
