# design-patterns

A pattern lookup mod for Claude Code. `/patterns` indexes all 22 classic GoF patterns (Refactoring.Guru catalog) with each pattern's "use when" line and the language idiom to try first. It is a quick selection aid; it does not ship skills or full implementations.

## The /patterns command

```
/patterns                       # usage help
/patterns strategy              # one pattern card: use-when + idiom first
/patterns list behavioral       # all 10 behavioral patterns with idioms
/patterns "switch-on-type smells everywhere"   # candidate suggestions
```

The lookup logic lives in `src/lib/index.ts`, a pure, unit-tested module that indexes the patterns with their "use when" and "idiom first" lines.

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
