# Kit loop measurements

Measures the Agentic SDLC Kit's own orchestration loop (`kit feature|fix <id> run`) on golden tasks. The
loop drives an agent through red, green and refactor, and the kit checks each phase with its evidence gate.
The harness reports whether each task converged, how many attempts each phase took, how many tool calls were
denied, and the tokens and time used.

## Run

```bash
pnpm measure:kit -- --dry-run          # prepare each project and start its feature; no agent, no model calls
pnpm measure:kit -- --task slugify     # live: start the kit's loop for one golden task
```

A live run starts a Claude Code agent for each task and spends model calls. It uses the credentials Claude
Code already has. The kit must be 0.9.1 or later, on `PATH` or named with `--kit` or `KIT_BIN`.

## Golden tasks

Each directory under `golden/` is a complete kit project: a spec, a plan, a profile and a `package.json`.
The harness copies it into a fresh git repository and commits it before the kit runs.

- `slugify`: one task, a pure function with two acceptance criteria. The smallest case that exercises the
  whole loop.

## What is reported

- `converged`: the kit reported the run completed, which means its final verification passed.
- `attempts`: executions per task and phase. A second green attempt means the first did not pass.
- `denials`: tool calls the agent's policy denied, counted from `tool.result` events with status `denied`.
- `tokens`: uncached input and output tokens from the stored execution records. Cache reads and cache
  creation are not in the kit's usage schema, so the input figure is a floor, not the full input cost. It
  is shown as `not reported` when the records carry no usage, never as zero.
- `duration`: from the kit's report timestamps, and the wall clock measured by the harness.

## Limits

- Results come from one run per task. Model output varies between runs, so compare several runs before
  drawing a conclusion.
- The field names the harness reads from execution records are taken from the kit's contracts. A live run
  is the check that they match what the kit writes; a mismatch shows up as `not reported`.
- Golden tasks are small on purpose. Convergence on them says little about larger features.

## Recorded runs

Kit 0.9.1 built from the kit repo with the permission fix (Edit rules, `acceptEdits` when writes are
granted). Golden task `slugify`, four live runs on 2026-11-27:

| run | converged | red / green / refactor attempts | denied calls | output tokens | uncached input | wall clock |
| --- | --------- | ------------------------------- | ------------ | ------------- | -------------- | ---------- |
| 1   | yes       | 1 / 1 / 1                       | 0            | 6,801         | 30             | 44 s       |
| 2   | yes       | 1 / 1 / 1                       | 0            | 5,967         | 30             | 44 s       |
| 3   | yes       | 1 / 1 / 1                       | 0            | 6,958         | 32             | 45 s       |
| 4   | yes       | 1 / 1 / 1                       | 0            | 6,525         | 32             | 43 s       |

Before the permission fix, the same task did not converge: every write was refused, and the kit's evidence
gate rejected the red phase. Four runs of one small task show little variance, but they say nothing about
harder tasks. Add larger golden tasks before comparing kit versions.
