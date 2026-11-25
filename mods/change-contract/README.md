# change-contract

Holds the task's objective, allowed and forbidden paths. Writes outside the contract are warned about or refused, according to its mode.

## Commands

| Command | What it does |
|---|---|
| `/contract` | Show, set or amend the change contract: /contract show|set|allow|forbid|mode|violations|close |

## Hooks

`command.run`, `session.start`, `tool.call`, `ui.render`.

## Install

```
/plugin install change-contract --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/change-contract` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
