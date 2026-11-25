# worktree-orchestrator

Lists git worktrees with their branches and uncommitted changes, and reports files that are changed in more than one worktree. Read-only: it never creates, removes or merges worktrees.

## Commands

| Command      | What it does                                        |
| ------------ | --------------------------------------------------- |
| `/worktrees` | List git worktrees and file collisions between them |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install worktree-orchestrator --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/worktree-orchestrator` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
