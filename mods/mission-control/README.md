# mission-control

Shows subagents as a tree: what each is doing, which files it touched, its tool calls, and a plain-language line per agent. Review agents are flagged. Templated from events, with no model calls.

## Commands

| Command      | What it does                                  |
| ------------ | --------------------------------------------- |
| `/subagents` | Show subagent activity in a pane (/subagents) |

## Hooks

`agent.report`, `agent.spawn`, `command.run`, `session.start`, `tool.call`, `ui.render`.

## Install

```
/plugin install mission-control --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/mission-control` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
