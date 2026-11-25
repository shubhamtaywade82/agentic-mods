# tdd-conductor

Runs the RED, GREEN and REFACTOR cycle. RED counts only when the test fails for a behavioral reason. Production edits are refused outside the implementation and refactor phases, unless an exception is recorded. Publishes the TDD gate.

## Commands

| Command | What it does        |
| ------- | ------------------- |
| `/tdd`  | TDD cycle: /tdd red | green | refactor | complete <test path>, /tdd exception <reason>, /tdd status |

## Hooks

`command.run`, `session.start`, `tool.call`.

## Install

```
/plugin install tdd-conductor --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/tdd-conductor` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
