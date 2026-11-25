# specification-guard

Checks acceptance criteria are written as Given/When/Then scenarios with the non-functional sections. Publishes the specification gate for the delivery workflows.

## Commands

| Command | What it does                                  |
| ------- | --------------------------------------------- |
| `/spec` | Check acceptance criteria: /spec check <path> | /spec template |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install specification-guard --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/specification-guard` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
