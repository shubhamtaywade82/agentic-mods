# verify

A verification-driven escalation engine mod for Claude Code. This is the architectural piece the reference repository (`claude-code-mods`) was **missing entirely**: a loop that runs _after_ a routed task completes, not just before it starts (which is all Switchboard does).

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

- `/verify-run <command> [args...]`: run the command (split into argv, no shell) and pass only when it exits 0. A failure whose output mentions a timeout or a retry is retried; any other failure aborts. Returns the outcome: status, attempts and the route each attempt recorded.
- `/verify-status`: session summary (completed / escalated / exhausted / aborted counts, average attempts per run).

The command adapter runs local commands, so the route it records (model and effort) is bookkeeping only; it does not change which model runs anything. The model and effort ladder takes effect when the engine is driven by an agent runtime that supplies its own `execute`.

## Architecture

- `src/lib/verification.ts`: the `VerifyEngine`, `verifyEngine` reference implementation, `RunOutcome`, `EscalationPolicy`, `ClassifyResult` (pure, runtime-agnostic)
- `src/lib/policy.ts`: `heuristicClassify`, `heuristicClassifyFailure`, `DEFAULT_POLICY`/`STRICT_POLICY` presets, built-in checks, `runChecks`, renderers (pure)
- `src/register.tsx`: the adapter that exposes the engine as commands, with `$.process.run` as `execute` and an exit-code check as `verify`

## Why this matters

Switchboard (the routing mod) makes a routing decision _before_ a subagent starts. It has no notion of whether the result was actually correct. `verify` closes that gap: it re-routes on failure, escalating the model/effort until deterministic checks pass or the policy is exhausted. Pair the two for the full pipeline: Switchboard picks the first route, verify escalates it.

The engine is deliberately independent of Claude Code's `agent.spawn` event so it can be reused by Nexum and other agent runtimes — only the adapter in `register.ts` knows about Claude Code.

## Develop

```bash
claude --plugin-dir ./mods/verify
claude plugin validate ./mods/verify
claude plugin test ./mods/verify
```

Requires Claude Code v2.1.330 or later. Tested with 2.1.332.

## Install

```
/plugin install verify --marketplace shubhamtaywade82/agentic-mods
```
