# verify

A verification-driven escalation engine mod for Claude Code. This is the architectural piece the reference repository (`claude-code-mods`) was **missing entirely**: a loop that runs *after* a routed task completes, not just before it starts (which is all Switchboard does).

## The pipeline

```
Task -> classify complexity/risk -> select RoutingPolicy (model + effort)
     -> execute -> verify with deterministic checks
       PASS -> complete
       FAIL -> classify failure -> escalate -> re-execute -> verify again
```

The engine walks four failure categories:
- **transient** — retry on the same route (network/flaky)
- **route-mismatch** — climb to the next route in the fallback ladder (wrong model/effort)
- **deterministic** — abort (retrying identically is pointless)
- **fatal** — abort immediately

It stops at `maxAttempts` (exhausted) or on a non-retryable failure (aborted).

## Commands

- `/verify-run <task>` — run a task through the full classify → execute → verify → escalate loop; returns the outcome (status, attempts, final route)
- `/verify-status` — session summary (completed / escalated / exhausted / aborted counts, avg attempts per run)

## Architecture

- `packages/core/src/verification.ts` — the `VerifyEngine`, `verifyEngine` reference impl, `RunOutcome`, `EscalationPolicy`, `ClassifyResult` (pure, runtime-agnostic)
- `hooks/lib/policy.ts` — `heuristicClassify`, `heuristicClassifyFailure`, `DEFAULT_POLICY`/`STRICT_POLICY` presets, built-in checks (`nonEmptyCheck`, `containsCheck`, `predicateCheck`), `runChecks`, renderers (pure)
- `hooks/register.ts` — thin adapter exposing the engine as commands; supplies the `execute` (host `$.tool.call`) and `verify` (runChecks) effects

## Why this matters

Switchboard (the routing mod) makes a routing decision *before* a subagent starts. It has no notion of whether the result was actually correct. `verify` closes that gap: it re-routes on failure, escalating the model/effort until deterministic checks pass or the policy is exhausted. Pair the two for the full pipeline: Switchboard picks the first route, verify escalates it.

The engine is deliberately independent of Claude Code's `agent.spawn` event so it can be reused by Nexum and other agent runtimes — only the adapter in `register.ts` knows about Claude Code.

## Develop

```bash
claude --plugin-dir ./mods/verify
claude plugin validate ./mods/verify
claude plugin test ./mods/verify
```

Requires Claude Code v2.1.287 or later.
