# guardian

A tool governance mod for Claude Code. It inspects `Bash`, `Write`, `Edit` and tool-result traffic and enforces five fail-closed policies:

1. **Blast-radius approval tier** — destructive shell commands (`rm -rf`, `git push --force`, history rewrites, schema migrations, prod database writes, `chmod -R 777 /`, `dd` to devices, `git clean -f`) are **held** with an impact preview and proceed only on explicit human approval. Non-interactive sessions (no approval capability, or a timeout) deny the op — never silently allow.
2. **Command-line secret redaction** — scans Bash command lines for credential shapes (AWS keys, GitHub PATs, Slack tokens, Google API keys, private key headers, JWT-style bearer tokens, `PASSWORD=`/`TOKEN=` assignments). High-confidence secrets block the call; lower-confidence matches are redacted in place.
3. **Git diff gate** — `git commit`/`push`/`tag` whose staged diff contains a secret are held or blocked before the secret enters history. Oversized diffs (above 256 KiB) are refused because they could not be scanned.
4. **Write/Edit secret protection** — file writes embedding a high-signal secret are denied; maybe-findings are redacted.
5. **Tool-result redaction** — secrets the tool *returned* are scrubbed before the model sees them, so a leaked value in stdout/output never enters the conversation.

A `/guardian-report` command summarizes what was blocked, held, approved and redacted in the session.

**Failure mode is fail-closed:** if a guardian hook throws or times out, or the host cannot answer an approval prompt, the Bash/Write call is denied, not allowed through.

## Scope and honesty

This is a pattern tripwire, not a shell parser, a sandbox, or a complete DLP product. It can miss secrets in unusual encodings and cannot reason about what a command *might* do. Use it as one layer; keep your real controls (permissions, sandboxing, secret scanning in CI) in place.

## Architecture

- `hooks/lib/secrets.ts` — secret patterns, redaction, `redactResult`, summarize (pure)
- `hooks/lib/blast.ts` — destructive-command rules (pure)
- `hooks/lib/gate.ts` — approval tier, git-diff inspection, `diffStat` (pure)
- `hooks/register.ts` — thin adapter wiring the libs to Claude Code events

The libs have no Claude Code imports, so they type-check and unit-test without a session.

## Develop

```bash
claude --plugin-dir ./mods/guardian
claude plugin validate ./mods/guardian
claude plugin test ./mods/guardian    # pattern tests + interception tests
```

Requires Claude Code v2.1.287 or later. Tested with 2.1.328.

## Install

```
/plugin install guardian --marketplace shubhamtaywade82/agentic-mods
```
