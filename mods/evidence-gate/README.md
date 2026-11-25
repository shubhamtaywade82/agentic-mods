# evidence-gate

Runs the configured build, test, lint, type-check and security commands, records their exit codes against a fingerprint of the repository, and holds git commit, push and PR creation until the required checks are current.

## Commands

| Command | What it does |
|---|---|
| `/evidence` | Show or run the verification checks: /evidence [run [check...] | clear] |

## Hooks

`command.run`, `session.start`, `tool.call`, `ui.render`.

## Install

```
/plugin install evidence-gate --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/evidence-gate` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
