# command-guard

Holds destructive shell commands for a decision, refuses the unsafe ones outright, and keeps secret files out of edits and reads.

## Commands

| Command  | What it does                                                           |
| -------- | ---------------------------------------------------------------------- |
| `/guard` | Show command-guard's settings, config problems and blocks this session |

## Hooks

`command.run`, `session.start`, `tool.call`.

## Depends on

`incident-timeline`

## Install

```
/plugin install command-guard --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/command-guard` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
