# contract-compatibility-guard

Runs the compatibility tools configured for this repository (OpenAPI diff, buf breaking, GraphQL inspector, Pact and similar) and records their results. It does not analyse schemas itself. Publishes the compatibility gate.

## Commands

| Command   | What it does                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `/compat` | Compatibility checks: /compat run [name] (tools from .agentic-mods/compat.json) |

## Hooks

`command.run`, `session.start`, `tool.call`.

## Install

```
/plugin install contract-compatibility-guard --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/contract-compatibility-guard` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
