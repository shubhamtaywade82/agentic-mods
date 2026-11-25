# test-impact

Maps changed JavaScript and TypeScript files to the tests that import them, flags changed code that no test reaches, and recommends the full suite for shared configuration. It selects tests and never runs them.

## Commands

| Command | What it does |
|---|---|
| `/impact` | Select the tests that the current changes reach |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Install

```
/plugin install test-impact --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/test-impact` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
