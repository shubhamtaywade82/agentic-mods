# migration-sentinel

Reviews SQL migration edits for destructive and table-locking changes, records the verdict for release readiness, and never executes SQL.

## Commands

| Command      | What it does                                    |
| ------------ | ----------------------------------------------- |
| `/migration` | Check a migration file: /migration check <path> |

## Hooks

`command.run`, `session.start`, `tool.call`.

## Install

```
/plugin install migration-sentinel --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/migration-sentinel` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
