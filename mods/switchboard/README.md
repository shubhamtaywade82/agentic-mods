# switchboard

Warns when two sessions edit the same file at once, lists current file claims, and sends a message to another session only when the person asks.

## Commands

| Command        | What it does                                                            |
| -------------- | ----------------------------------------------------------------------- |
| `/switchboard` | List file claims across sessions, or /switchboard send <session> <text> |

## Hooks

`command.run`, `session.start`, `tool.call`.

## Install

```
/plugin install switchboard --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/switchboard` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
