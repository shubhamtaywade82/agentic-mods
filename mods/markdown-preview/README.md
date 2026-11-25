# markdown-preview

Renders a Markdown file from the repository in a pane, so READMEs, ADRs and reports can be read without leaving the session.

## Commands

| Command    | What it does                                                 |
| ---------- | ------------------------------------------------------------ |
| `/preview` | Render a repository Markdown file in a pane: /preview <path> |

## Hooks

`command.run`, `session.start`, `ui.render`.

## Install

```
/plugin install markdown-preview --marketplace shubhamtaywade82/agentic-mods
```

Mods run with your permissions and are not sandboxed. Read what a mod calls with `claude plugin validate mods/markdown-preview` before loading it. Settings, where a mod has any, are in `.agentic-mods/config.json`; see the root README.
