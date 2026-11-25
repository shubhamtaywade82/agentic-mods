#!/usr/bin/env bash
# Validate, type-check and test a mod directory.
# Usage: scripts/check.sh [mod-dir]        (default: my-mod)
#        STRICT=1 scripts/check.sh my-mod  (treat warnings as errors)
#        CI=1 scripts/check.sh my-mod      (require the type-check; do not skip)
set -euo pipefail

MOD_DIR="${1:-my-mod}"
FLAGS=()
[[ "${STRICT:-0}" == "1" ]] && FLAGS+=(--strict)
CI_MODE="${CI:-0}"

echo "Claude Code: $(claude --version)"

echo "== validate (manifest, hooks, calls, TypeScript) =="
claude plugin validate "$MOD_DIR" "${FLAGS[@]}"

echo "== typecheck (tsc) =="
TYPES="$MOD_DIR/.claude-plugin/types/claude-code/index.d.ts"
if [[ "$CI_MODE" == "1" ]]; then
  # CI must fail when the type-check cannot run at all.
  command -v tsc >/dev/null 2>&1 || { echo "FAIL: tsc not installed (CI=1 requires it)"; exit 1; }
  [[ -f "$TYPES" ]] || { echo "FAIL: $TYPES missing; run 'claude --plugin-dir $MOD_DIR' once to generate it"; exit 1; }
  tsc -p "$MOD_DIR"
  echo "tsc: ok"
elif [[ -f "$TYPES" ]] && command -v tsc >/dev/null 2>&1; then
  tsc -p "$MOD_DIR"
  echo "tsc: ok"
else
  echo "skipped: needs tsc 5.4+ and the types Claude Code writes the first time you run:"
  echo "  claude --plugin-dir $MOD_DIR"
fi

echo "== test =="
claude plugin test "$MOD_DIR"
echo "All checks passed for $MOD_DIR"
