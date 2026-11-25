# mod-template

A TypeScript starter mod for the agentic-mods library. It counts the tool-call **attempts** Claude makes (incremented before each call, so denied or failed calls are included), shows the count beside the spinner while Claude works, and adds two commands: `/mod-template-tally` prints the count, and `/mod-template-usage` prints context-window and plan-limit usage from the session. Copy this folder, rename it, and replace the hooks with your own. Mods run with your permissions and are not sandboxed, so read what a mod calls (`claude plugin validate`) before loading it.

## Layout

```text
mod-template/
├── .claude-plugin/plugin.json   manifest (name must not start with "claude-")
├── hooks/hooks.json             "modules" key points at the code; this makes it a mod
├── hooks/register.ts            the adapter: export const register: Register; only file touching $
├── hooks/lib/counter.ts         pure logic: attempt counting and labels
├── hooks/lib/usage.ts           pure logic: usage formatting (defensive against bad data)
├── tests/mod-template.test.ts   session-level tests run by `claude plugin test`
├── tests/lib.test.ts            unit tests for the pure libs
├── tsconfig.json                editor and tsc settings for a hooks module
├── scripts/check.sh             validate + type-check + test
└── .gitignore                   ignores the generated .claude-plugin/types/
```

There is no build step. Claude Code loads `.ts` files directly.

The `hooks/lib/` split is the pattern to keep: `register.ts` is a thin adapter over the Claude Code event API, and everything else is pure TypeScript you can type-check with a pinned `tsc` and test without a session. This is the same separation the whole library uses, so business logic stays portable to other agent runtimes.

## Develop

```bash
claude --plugin-dir ./mods/mod-template   # load for one session; hot-reloads on save
```

Inside the session run `/plugin` and open the Installed tab to confirm it loaded. Each load writes the exact type declarations for your Claude Code version into `.claude-plugin/types/`, which gives your editor autocomplete on every event and `$` method (TypeScript 5.4 or newer).

## Validate, type-check and test

```bash
claude plugin validate ./mods/mod-template            # lists hooks: and calls:, type-checks .ts, reports errors
claude plugin validate ./mods/mod-template --strict   # also fails on warnings
tsc -p ./mods/mod-template                            # full type-check (after the types exist)
claude plugin test ./mods/mod-template                # runs tests/*.test.ts, no session or network
```

Or run `scripts/check.sh` from the folder above (`STRICT=1` for strict, `CI=1` to make a skipped type-check fail — use that in CI).

## What the tests pin down

- The tally counts attempts, including calls denied by a later hook.
- `formatUsage` handles populated data, empty rate limits, multiple limit windows, and non-finite/missing numbers without rendering `NaN`.

## Rules the validator enforces

- Event names in `on(...)` are string literals.
- Call the mods API in full, such as `$.ui.invalidate(...)`. Do not destructure or alias `$`.
- ES modules only. Relative imports inside this folder, plus the type-only import `claude-code`. No `import()`.
- Do not shadow `on` inside `register`.

Requires Claude Code v2.1.287 or later. Tested with 2.1.328.
