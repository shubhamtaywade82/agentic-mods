# mod-firewall

Watches network requests and process launches made by other mods, enforces an allowlist, and keeps an audit trail.

## Commands

| Command | What it does |
|---|---|
| `/firewall` | Show recent network and process decisions made for other mods |

## Hooks

`command.run`, `http.fetch`, `process.run`, `session.start`.

## Install

```
/plugin install mod-firewall --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/mod-firewall` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
