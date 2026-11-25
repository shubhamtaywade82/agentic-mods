# pulse

A session observability mod for Claude Code. It counts tool-call **attempts** per tool (denied calls included), estimates context-window pressure from `$.session.usage()`, and shows a compact readout beside the spinner while Claude works: `· pulse: 12 calls, context 34000/200000 (17%, ok)`. Two commands: `/pulse-report` prints the per-tool tally and context line; `/pulse-usage` prints the one-liner.

All telemetry is in-memory and resets when the mod reloads; nothing is written to disk or sent anywhere.

## What it tracks

| Signal | Meaning |
|---|---|
| Tool-call attempts | Counted before `next(e)`, so denied/failed attempts are included |
| Per-tool tally | Bounded to 50 distinct tools (totals stay exact; itemization is capped — the Mission Control rule against unbounded state) |
| Context pressure | `tokens/window` mapped to bands: ok < 50% ≤ caution < 75% ≤ high < 90% ≤ critical |

## Architecture

- `hooks/lib/stats.ts` — `ToolStats`, pressure bands, renderers (pure, unit-tested)
- `hooks/register.ts` — thin adapter: `tool.call` records, `ui.render` Spinner rewrites the suffix, two `command.run` answerers

The lib has no Claude Code imports, so it type-checks and unit-tests without a session.

## Develop

```bash
claude --plugin-dir ./mods/pulse
claude plugin validate ./mods/pulse
claude plugin test ./mods/pulse     # stats unit tests + command tests
```

Requires Claude Code v2.1.287 or later. Tested with 2.1.328.

## Install

```
/plugin install pulse --marketplace shubhamtaywade82/agentic-mods
```
