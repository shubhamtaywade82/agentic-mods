# learning-ledger

Keeps repository lessons as reviewable records. A lesson is proposed, then approved by the person, and goes stale when a file it cites changes.

## Commands

| Command   | What it does                               |
| --------- | ------------------------------------------ |
| `/lesson` | Repository lessons: /lesson propose <text> | <paths>, approve | reject | retire <id>, check |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install learning-ledger --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/learning-ledger` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
