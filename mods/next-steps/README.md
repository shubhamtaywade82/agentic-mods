# next-steps

After a turn that changed files, offers up to three suggested next prompts in a row above the prompt. Taking one puts it in the prompt box for editing.

## Commands

| Command | What it does                |
| ------- | --------------------------- |
| `/next` | Show suggested next prompts |

## Hooks

`session.start`, `tool.call`, `turn.complete`, `turn.start`, `ui.render`.

## Install

```
/plugin install next-steps --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/next-steps` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
