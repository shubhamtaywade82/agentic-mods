# turn-replay

Records every Edit and Write as a diff, grouped by turn, and shows them one at a time in a pane so a large change can be reviewed in steps.

## Commands

| Command | What it does |
|---|---|
| `/replay` | Step through the file changes of the session: /replay [number] |

## Hooks

`command.run`, `session.start`, `tool.call`, `turn.start`, `ui.render`.

## Install

```
/plugin install turn-replay --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/turn-replay` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
