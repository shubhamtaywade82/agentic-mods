# workflow-conductor

Runs a delivery workflow (feature, TDD, bug fix, regression, refactoring, pull request, release, hotfix, incident) stage by stage. A stage advances only when its gate's evidence is current, or an approved deferral is recorded. Artifacts and the decision log are written under .agentic-mods/tasks.

## Commands

| Command | What it does |
|---|---|
| `/decision` | Record a decision: /decision <title> | <decision> | <consequences> |
| `/record` | Append to a task artifact: /record <file.md> <text> |
| `/workflow` | Delivery workflow: /workflow start|status|advance|defer|cancel |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Depends on

`evidence-gate`, `change-contract`, `review-tracker`, `architecture-guard`, `migration-sentinel`, `dependency-radar`, `performance-budget`, `specification-guard`, `change-planner`, `regression-orchestrator`, `tdd-conductor`, `defect-protocol`, `behavior-lock`, `contract-compatibility-guard`, `observability-verifier`, `release-conductor`

## Install

```
/plugin install workflow-conductor --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/workflow-conductor` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
