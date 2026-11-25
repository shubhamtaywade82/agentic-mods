# code-pet

A small status creature above the prompt whose mood follows the evidence state and how much tool activity the turn has had. It reads evidence-gate's published state and changes nothing.

## Hooks

`tool.call`, `turn.complete`, `turn.start`, `ui.render`.

## Depends on

`evidence-gate`

## Install

```
/plugin install code-pet --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/code-pet` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
