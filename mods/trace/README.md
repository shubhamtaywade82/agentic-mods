# trace

An execution observability mod for Claude Code. It listens to the session lifecycle (`session.start`, `turn.start`, `agent.spawn`, `tool.call`, `tool.result`, `turn.complete`) and builds a **bounded hierarchical runtime tree**: main agent → subagents → tool calls, with parent/child links, per-node status (running/completed/failed/cancelled), duration, and the files each node touched.

This is the architectural piece `pulse` was too flat to provide — `pulse` counts attempts, `trace` records the _shape_ of the run, so you can answer "which subagent did what, and where did it fail?".

## Commands

- `/trace` — full indented execution tree for the session
- `/trace-summary` — one-line counts (running/completed/failed, agents, tools, files touched)
- Spinner suffix shows `running / total nodes (agents, tools)` live

## Architecture

- `packages/core/src/trace.ts` — the `ExecutionTrace` contract + `InMemoryTrace` store (pure, runtime-agnostic, bounded to 500 nodes by default with leaf-first eviction)
- `hooks/lib/summary.ts` — event→store mapping helpers + summary stats (pure)
- `hooks/register.ts` — thin adapter wiring host events to the store

The store is pure TypeScript with no `claude-code` import, so the same contract can feed a future developer dashboard (Mission Control style) or any other runtime (Nexum, etc.).

## Bound memory

The store caps tracked nodes (default 500). When full, the oldest _leaf_ node is evicted first — never the main agent — so the tree structure stays intact while bounded.

## Develop

```bash
claude --plugin-dir ./mods/trace
claude plugin validate ./mods/trace
claude plugin test ./mods/trace
```

Requires Claude Code v2.1.287 or later.

## Install

```
/plugin install trace --marketplace shubhamtaywade82/agentic-mods
```
