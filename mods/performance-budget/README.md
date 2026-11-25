# performance-budget

Compares measurements from benchmark and bundle-size reports against the budgets in .agentic-mods/budgets.json. A missing measurement is UNKNOWN, never a pass.

## Commands

| Command | What it does |
|---|---|
| `/perf` | Check a measurement against budgets: /perf check <generic|vite-stats|jmh|pytest-benchmark|go-bench> <path> |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install performance-budget --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/performance-budget` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
