# commentary

A one-line commentary above the prompt about the latest tool activity, in a sportscaster or monologue voice, chosen with /commentary. Templated: it makes no model calls.

## Commands

| Command       | What it does                        |
| ------------- | ----------------------------------- |
| `/commentary` | Commentary voice: /commentary sport | monologue | off |

## Hooks

`command.run`, `session.start`, `tool.call`, `ui.render`.

## Install

```
/plugin install commentary --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/commentary` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
