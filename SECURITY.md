# Security

## Reporting

Report suspected vulnerabilities privately through this repository's security advisory feature, not
in a public issue. Include the mod name, the steps to reproduce and the Claude Code version.

## What the mods can and cannot do

- Mods run inside the Claude Code session, with the privileges of the user who runs it.
- Network: a mod can only make requests through `$.http.fetch`, which is subject to the host's web
  policy. Native mods make no requests on their own except `observability-verifier`, which only
  issues GET requests to URLs listed in `.agentic-mods/observability.json`.
- Processes: `$.process.run` runs argv without a shell. Git runs with repository hooks disabled by
  the host. `mod-firewall` checks calls made by mods that are not native to this repository.
- Writes: a mod's own writes are confined to `.agentic-mods/` by the path guard in
  `packages/core/src/paths.ts`. The engine does not restrict writes by the model itself, so an
  Edit or Write from the model is checked by `command-guard` and `change-contract` only when those
  are enabled and configured.
- Secrets: protected-file globs (`.env`, keys, credentials) are refused by `command-guard` for Edit,
  Write and Read. Audit lines and timelines pass through a redactor that masks common token formats
  and `key=value` secrets. The redactor is a best effort, not a guarantee.
- Telemetry: none. No mod sends data off the machine.

## Known gaps

- Bash commands that read secret files (for example `cat .env`) are not inspected.
- A confirm-level command decision depends on the tier the person chooses. `always-block` commands
  are refused in every tier.
- Command names are checked against the engine's reserved list at validation time. Run
  `pnpm validate` after adding a command.
