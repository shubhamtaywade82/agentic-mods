# incident-timeline

Records an incident as an append-only timeline, switches command-guard to its strict profile while it is open, and writes the postmortem.

## Commands

| Command | What it does |
|---|---|
| `/incident` | Open, log, mitigate, recover and close an incident, or write its postmortem |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Install

```
/plugin install incident-timeline --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/incident-timeline` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
