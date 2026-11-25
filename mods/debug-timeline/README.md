# debug-timeline

Records the commands run during debugging, the hypotheses proposed and their outcomes, and flags repeated commands so circular investigation is visible.

## Commands

| Command | What it does |
|---|---|
| `/hypothesis` | Record a debugging hypothesis: /hypothesis <text> |
| `/result` | Record a hypothesis outcome: /result <id> confirmed|rejected <evidence> |
| `/timeline` | Show the debugging timeline in a pane |

## Hooks

`command.run`, `session.start`, `tool.call`, `ui.render`.

## Install

```
/plugin install debug-timeline --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/debug-timeline` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
