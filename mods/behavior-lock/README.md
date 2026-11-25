# behavior-lock

Captures the exported surface of TypeScript or JavaScript files before a refactoring, then compares it afterwards. Removed or changed exports fail the gate; added exports are reported as additive. The surface is read as text, not type-checked.

## Commands

| Command | What it does                                   |
| ------- | ---------------------------------------------- |
| `/lock` | Behavior lock: /lock capture <name> <files...> | /lock compare <name> |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install behavior-lock --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/behavior-lock` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
