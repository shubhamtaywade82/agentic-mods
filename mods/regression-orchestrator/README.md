# regression-orchestrator

Scores the regression risk of the working tree, explains the score, and runs the configured scope for its level. Publishes the regression gate. Commands are configured per repository in .agentic-mods/regression.json.

## Commands

| Command       | What it does                         |
| ------------- | ------------------------------------ |
| `/regression` | Regression scope: /regression assess | /regression run |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install regression-orchestrator --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/regression-orchestrator` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
