# verify

Runs the verification checks a repository declares, and reports a pass only when every declared command exits 0. It is a deterministic check runner: it does not choose models, and it does not retry.

## What changed, and why

The previous version ran whatever text followed `/verify-run` as a process, and escalated failures by re-running commands and by climbing a model/effort ladder that never reached the executor. That gave an unchecked process path, re-executed non-idempotent commands on a "transient" failure, and reported escalation that did not happen. Those behaviours are removed:

- **Only declared commands run.** `/verify-run <check>` names a check. The command is the one declared for it under `evidence.commands` in `.agentic-mods/config.json`. Text is never split into argv.
- **The process policy applies.** A declared command is judged by the same destructive-operation classifier as a Bash command. A destructive command is refused, even when it is declared. `mod-firewall` judges every process launch again, including launches by native mods.
- **No retries.** A failed command is reported once and not re-executed.
- **No model routing.** The mod runs commands. It does not select a model or effort, so it records none.

## Configure checks

```json
{
  "evidence": {
    "commands": {
      "lint": [["pnpm", "lint"]],
      "test": [
        ["pnpm", "test"],
        ["pnpm", "test:core"]
      ],
      "typecheck": [["pnpm", "typecheck"]]
    }
  }
}
```

Each argv runs without a shell, in declaration order. Check names are `build`, `test`, `lint`, `typecheck` and `security`. A check with no declared command, or with a command the policy refuses, cannot run.

## Commands

- `/verify-run` lists the checks that can run.
- `/verify-run <check>` runs the check's commands in order and stops at the first non-zero exit. The result shows each command and its exit code, and the output tail of the failing command.
- `/verify-status` summarises the checks run this session.

## Limits

- The process policy does not inspect code run inside an interpreter (`python -c`, `node -e`). That is why only declared commands run.
- `evidence.runTimeoutMs` is not applied by this mod: the engine's `process.run` call is made without a timeout option.

## Architecture

- `packages/core/src/verify.ts`: check selection, the single-attempt runner, and renderers (pure).
- `packages/core/src/command-policy.ts`: the process policy, which reuses the sdlc-guard classifier vendored from agentic-sdlc-kit.
- `src/register.tsx`: the adapter, which exposes the runner as commands and uses `$.process.run` as the executor.

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
