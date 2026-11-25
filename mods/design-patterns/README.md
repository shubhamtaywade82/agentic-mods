# design-patterns

A reference mod bundling two drop-in agent skills covering all 22 classic GoF patterns (Refactoring.Guru catalog), written for idiomatic modern stacks, plus a `/patterns` lookup command for quick selection.

| Skill | Stack | Tests |
|---|---|---|
| `skills/typescript-node-design-patterns/` | TypeScript 5 (strict), Node 20+, Express/Fastify/NestJS, Prisma, BullMQ | Vitest (Jest-compatible) |
| `skills/ruby-rails-design-patterns/` | Ruby 3.2+, Rails 7/8, Zeitwerk, ActiveJob, ActiveSupport::Notifications | RSpec, FactoryBot, WebMock/VCR |

Each pattern entry contains: intent · use when · avoid when · the language idiom to try first · a production-style implementation (payments, checkout, orders, imports, notifications) · tests · pitfalls. Each skill also has a 9-step workflow, a selection table, project placement conventions, a smell → refactoring → pattern map, a PR review checklist, and a testing guide with contract-test suites.

## The /patterns command

```
/patterns                       # usage help
/patterns strategy              # one pattern card: use-when + idiom first
/patterns list behavioral       # all 10 behavioral patterns with idioms
/patterns "switch-on-type smells everywhere"   # candidate suggestions
```

The lookup logic lives in `hooks/lib/index.ts` — a pure, unit-tested module indexing all 22 patterns with their "use when" and "idiom first" lines. The full implementations stay in the skills' `references/` files, which Claude reads when working on a refactor.

## Develop

```bash
claude --plugin-dir ./mods/design-patterns
claude plugin validate ./mods/design-patterns
claude plugin test ./mods/design-patterns   # index + renderer tests
```

Requires Claude Code v2.1.287 or later. Tested with 2.1.328.

## Install

```
/plugin install design-patterns --marketplace shubhamtaywade82/agentic-mods
```
