# defect-protocol

Tracks a defect from symptom to root cause to fix and regression test. A defect counts as reproduced only with a reproduction or a documented reason it cannot be reproduced. Publishes the defect gate.

## Commands

| Command   | What it does                                                                      |
| --------- | --------------------------------------------------------------------------------- |
| `/defect` | Defect protocol: /defect open <title>, /defect set <field> <text>, /defect status |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install defect-protocol --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/defect-protocol` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
