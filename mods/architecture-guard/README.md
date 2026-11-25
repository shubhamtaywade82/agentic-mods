# architecture-guard

Checks imports in edited TypeScript, JavaScript and Java files against the layer rules in configuration. Existing violations in the baseline are grandfathered; only new ones are warned about or refused.

## Commands

| Command | What it does |
|---|---|
| `/architecture` | Architecture layer checks: /architecture scan (records the baseline) or /architecture status |

## Hooks

`command.run`, `session.start`, `tool.call`, `ui.render`.

## Install

```
/plugin install architecture-guard --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/architecture-guard` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
