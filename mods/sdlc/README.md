# sdlc

A complete software development lifecycle kit as a Claude Code mod. It registers `/sdlc-*` slash commands that drive an 8-stage feature lifecycle — clarify → PRD → tech spec → task plan → TDD build → review → debug/refactor → release — with human approval gates, artifacts on disk (`docs/{prd,specs,plans,adr}`), and test-first implementation. Use it to build whole apps or incremental features.

## What you get

| Layer    | Contents                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands | `/sdlc-init`, `/sdlc-feature`, `/sdlc-prd`, `/sdlc-spec`, `/sdlc-plan`, `/sdlc-tdd`, `/sdlc-review`, `/sdlc-debug`, `/sdlc-refactor`, `/sdlc-ship`, `/sdlc-audit` |
| Code     | `src/lib/commands.ts` — pure command registry and self-contained stage prompts (unit-tested); `src/register.tsx` — thin adapter                                   |

## Quick start

```bash
claude --plugin-dir ./mods/sdlc     # or install via the marketplace
```

Then, in the session:

```
/sdlc-init                          # once per repo: AGENTS.md + docs/ scaffolding
/sdlc-feature "Add password reset via email"
```

That runs the full loop: clarify → PRD → spec → task plan → TDD implementation → self-review → PR, pausing for your approval at each gate. For a small fix, skip straight to `/sdlc-tdd` or just write the test.

## Architecture

`register.ts` only wires events; every command's instruction text is composed by `lib/commands.ts`, a pure module with no Claude Code imports. That keeps prompts diffable and testable, and lets the lifecycle logic be reused by other agent runtimes later.

## Develop

```bash
claude plugin validate ./mods/sdlc
tsc -p ./mods/sdlc                  # after .claude-plugin/types/ exists
claude plugin test ./mods/sdlc      # registry, slugify, prompt builder, register tests
```

Requires Claude Code v2.1.330 or later. Tested with 2.1.332.

## Install

```
/plugin install sdlc --marketplace shubhamtaywade82/agentic-mods
```
