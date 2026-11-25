# cache-clock

Shows how long the prompt cache from the last turn is expected to stay warm. It only displays the estimate and never sends requests to keep it warm.

## Hooks

`session.start`, `turn.complete`, `ui.render`.

## Install

```
/plugin install cache-clock --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/cache-clock` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
