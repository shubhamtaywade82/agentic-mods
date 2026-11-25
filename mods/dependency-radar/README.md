# dependency-radar

Diffs direct dependencies when a manifest or lockfile is edited (added, removed, major-version changes), and reads scanner results saved under .agentic-mods/scans. It never contacts the network.

## Commands

| Command  | What it does                                   |
| -------- | ---------------------------------------------- |
| `/radar` | Read the recorded dependency scan: /radar scan |

## Hooks

`command.run`, `session.start`, `tool.call`.

## Install

```
/plugin install dependency-radar --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/dependency-radar` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
