# session-wrapped

Counts the session's turns, tool calls and file edits, and shows a text summary with /wrapped. It does not create images and writes nothing to disk.

## Commands

| Command | What it does |
|---|---|
| `/wrapped` | Summarise this session: turns, tool calls, edits |

## Hooks

`command.run`, `session.start`, `tool.call`, `turn.start`.

## Install

```
/plugin install session-wrapped --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/session-wrapped` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
