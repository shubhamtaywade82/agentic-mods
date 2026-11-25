# observability-verifier

Checks the health endpoints configured in .agentic-mods/observability.json after a change, and publishes the observability gate. It makes GET requests only, through the host's network policy.

## Commands

| Command | What it does |
|---|---|
| `/observe` | Health checks after a change: /observe check |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install observability-verifier --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/observability-verifier` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
