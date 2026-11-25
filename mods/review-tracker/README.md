# review-tracker

Turns review findings into tracked records with a lifecycle and a required reason or evidence at each resolution. Unresolved high-severity findings fail the review gate.

## Commands

| Command | What it does |
|---|---|
| `/finding` | Track review findings: /finding add|set|list |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Install

```
/plugin install review-tracker --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/review-tracker` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
