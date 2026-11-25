# ci-triage

Classifies a CI failure log (compilation, unit, integration, flaky, infrastructure, credentials, lint, security, performance) and recommends the next action. It stops the loop when the cause is infrastructure or credentials, because more code edits cannot fix those.

## Commands

| Command | What it does |
|---|---|
| `/ci` | Triage a CI log file: /ci triage <path to the downloaded log> |

## Hooks

`command.run`, `session.start`.

## Install

```
/plugin install ci-triage --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/ci-triage` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
