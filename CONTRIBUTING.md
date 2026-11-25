# Contributing to agentic-mods

Thanks for improving the library. This guide covers the layout, the rules each
file kind follows, and how to verify and submit a change.

## Ways to contribute

- Fix a mod: a guard that misses a pattern, a command prompt that misleads, a stale skill reference
- Add a mod (see "Adding a new mod" below)
- Improve the kit material: workflows, checklists, templates inside `mods/sdlc/skills/`
- Improve tooling: `scripts/check.sh`, the offline type stubs, CI
- Report a problem: open an issue with your Claude Code version (`claude --version`),
  the mod, what you asked, what happened, and what you expected

## The architecture rule

Every mod must keep this separation:

| Layer | Path | Rule |
|---|---|---|
| Adapter | `hooks/register.ts` | The ONLY file that imports `claude-code`. Thin: match events, call lib functions, shape results |
| Logic | `hooks/lib/*.ts` | Pure TypeScript. No `claude-code` imports. Strict mode clean |
| Reference | `skills/`, `references/` | Markdown Claude reads; SKILL.md entry point per skill |
| Tests | `tests/*.test.ts` | Lib unit tests + session interception tests |

If you find yourself writing logic inside `register.ts`, move it to `lib/` and
test it. The offline type-check (`tsc -p scripts/tsconfig.check.json`) covers
`hooks/` and `tests/` of every mod — new files are picked up only if you add
their directory to that tsconfig's `include`.

## Rules the validator enforces (know them before editing)

- Event names in `on(...)` are string literals
- Call the mods API in full (`$.ui.invalidate(...)`); never destructure or alias `$`
- ES modules only; relative imports inside the mod folder plus the type-only `claude-code`; no `import()`
- Do not shadow `on` inside `register`
- The plugin name must match the directory name and must not start with `claude-`

Guard-style hooks fail closed; observe-style hooks may fail open. If you add a
guard, add a `.catch` that denies, and a test for it.

## Writing guidelines

- Reference files (`skills/**`): direct, imperative, specific. One rule per line where possible.
- Denial and log messages must never echo the secret or the destructive command.
- Tests: behavior, not implementation. One reason to fail per test. Cover the
  empty / multiple / malformed variants (see `mods/mod-template/tests/lib.test.ts`
  for the pattern).
- No real credentials in fixtures — the test secrets are documented dummy shapes.

## Adding a new mod

```bash
bash scripts/new-mod.sh my-mod
```

This scaffolds from `mods/mod-template`, renames plugin and commands, and
registers the mod in `.claude-plugin/marketplace.json`. Then:

1. Replace the counter/usage logic with your own `hooks/lib/` module.
2. Keep `register.ts` thin (see the architecture rule).
3. Add tests: unit tests for the lib + session tests for interception.
4. Add your mod's directories to `scripts/tsconfig.check.json` `include`.
5. Write the mod README (what it does, scope, failure mode, how to develop).
6. Run the checks (below) and try the mod in a real session.

## Testing your change

```bash
bash scripts/check.sh        # offline: JSON, shell, structure, stub type-check
CI=1 bash scripts/check.sh   # full: needs the Claude CLI; validate + test every mod
```

What the offline pass checks: JSON manifests parse; shell scripts pass `bash -n`;
every mod has manifest/hooks/README/tests; names match directories; the
marketplace lists every mod and vice versa; `tsc` passes against the
`scripts/stub/` API stubs; skill references resolve.

What the CLI pass adds: `claude plugin validate` and `claude plugin test` on
every mod, and marketplace validation. CI runs both passes plus a
`2.1.330`/`latest` version matrix.

For guard or secret-pattern changes, add regression tests for: multiple
distinct secrets of the same kind in one payload, overlapping findings, and
value-anchored redaction (the exact substring, not just the kind).

## Submitting a pull request

1. Branch: `feat/<slug>`, `fix/<slug>`, or `docs/<slug>`.
2. One topic per PR; conventional commits (`feat(guardian): detect slack bot tokens`).
3. Run `bash scripts/check.sh` (and `CI=1` variant if you have the CLI).
4. Update the mod's README if user-visible behavior changed; update the root
   README table when adding a mod.
5. Open the PR with: what changed, how verified (commands + output), risks.

## Review process

A maintainer checks: the architecture rule is intact (no `claude-code` imports
in `lib/`), tests cover the new behavior, denial messages leak nothing, the
offline check passes, and — for new API surface — the change was validated
against both the minimum and latest Claude Code versions.
