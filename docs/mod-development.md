# Developing a mod

## Add a mod

1. `pnpm create-mod <name> "<one-line description>" [--state]`. This scaffolds the folder.
2. Add the name to `NATIVE_MODS` in `packages/core/src/native.ts`. `pnpm validate` fails if the list
   and the folders disagree.
3. Write `src/register.tsx`. Keep logic in `packages/core` when it is pure.
4. `pnpm build && pnpm typecheck && pnpm validate`.
5. `pnpm registry` to refresh the marketplace.

## Rules the engine enforces (learned from `claude plugin validate`)

- `register` must be an exported **function declaration**: `export function register(on: On): void`.
  An exported `const` arrow is refused after bundling.
- Helpers that receive `$` must be **top-level** functions in the module, not declared inside
  `register`.
- Atom references need **literal** `plugin` and `key` strings, written in the atom call itself.
- A state key a mod reads or writes must be declared in its `types/index.d.ts` and listed by
  `"types"` in `plugin.json`.
- A catch handler that ignores `$` must name it `_$`.
- Command names must not be names Claude Code ships. `/plan` and `/agents` were refused; use
  `/change-plan` and `/subagents`.
- The engine's built-in tool list has no `MultiEdit` in this build. Hook `Edit` and `Write` only.

## Checks

- `pnpm typecheck` — strict TypeScript against the engine declarations.
- `pnpm build` — fails if a bundle contains an import other than `claude-code`.
- `pnpm validate` — the engine's own validator, plus the native-list check.

Unit tests are not part of this repository yet. Add them when the test wave starts; the pure
modules in `packages/core` are the first candidates.
