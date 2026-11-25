#!/usr/bin/env bash
# Check every mod in this library + the library itself.
# Usage: bash scripts/check.sh           (local: type-check optional)
#        CI=1 bash scripts/check.sh      (Claude CLI present: full validate+test)
#        OFFLINE=1 bash scripts/check.sh (no Claude CLI: JSON, bash, tsc, refs)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OFFLINE="${OFFLINE:-0}"
CI="${CI:-0}"
fail=0
err() { echo "FAIL: $*"; fail=1; }
note() { echo "-- $*"; }

MODS=()
for d in "$ROOT"/mods/*/; do
  [ -f "$d/.claude-plugin/plugin.json" ] && MODS+=("${d%/}")
done
note "mods found: ${MODS[*]#$ROOT/mods/}"

# ---------------------------------------------------------------- JSON files
note "JSON manifests parse"
for f in "$ROOT/.claude-plugin/marketplace.json" "$ROOT"/package.json; do
  jq -e . "$f" >/dev/null || err "invalid JSON: ${f#$ROOT/}"
done
for m in "${MODS[@]}"; do
  jq -e . "$m/.claude-plugin/plugin.json" >/dev/null || err "invalid JSON: ${m#$ROOT/}/.claude-plugin/plugin.json"
  jq -e . "$m/hooks/hooks.json" >/dev/null || err "invalid JSON: ${m#$ROOT/}/hooks/hooks.json"
done

# ------------------------------------------------------------- shell scripts
note "shell scripts parse (bash -n)"
for f in "$ROOT"/scripts/*.sh "$ROOT"/mods/*/scripts/*.sh; do
  [ -e "$f" ] || continue
  bash -n "$f" || err "syntax error in ${f#$ROOT/}"
done

# ------------------------------------------------------------ mod structure
note "each mod has the required files"
for m in "${MODS[@]}"; do
  n="${m#$ROOT/mods/}"
  for f in .claude-plugin/plugin.json hooks/hooks.json; do
    [ -f "$m/$f" ] || err "$n: missing $f"
  done
  if [ ! -f "$m/hooks/register.ts" ] && [ ! -f "$m/hooks/register.js" ] && [ ! -f "$m/src/register.tsx" ]; then
    err "$n: missing hooks implementation (hooks/register.ts, hooks/register.js, or src/register.tsx)"
  fi
  if [ ! -f "$m/README.md" ] && [ ! -f "$ROOT/README.md" ]; then
    err "$n: missing README.md"
  fi
  # plugin name must match the directory and not start with claude-
  name=$(jq -r .name "$m/.claude-plugin/plugin.json")
  [ "$name" = "$n" ] || err "$n: plugin.json name '$name' != directory name"
  case "$name" in claude-*) err "$n: name must not start with 'claude-'";; esac
  # hooks.json must reference existing modules
  while IFS= read -r mod_file; do
    [ -f "$m/hooks/$mod_file" ] || err "$n: hooks.json references missing hooks/$mod_file"
  done < <(jq -r '.modules[]' "$m/hooks/hooks.json")
  # mods with a tests directory must have tests
  if [ -d "$m/tests" ]; then
    ls "$m"/tests/*.test.ts >/dev/null 2>&1 || err "$n: no tests/*.test.ts"
  fi
done

# ------------------------------------------------------------ marketplace
# Schema: each plugins[] entry is { name, source, description }. Verify every
# mod dir is listed, the listed name matches its plugin.json, and the source
# path resolves to a real directory.
note "marketplace lists every mod directory"
listed_sources=$(jq -r '.plugins[].source' "$ROOT/.claude-plugin/marketplace.json")
for m in "${MODS[@]}"; do
  rel=".${m#$ROOT}"
  echo "$listed_sources" | grep -qxF "$rel" || err "marketplace.json does not list ${m#$ROOT/} (source '$rel' missing)"
done
while IFS=$'\t' read -r pname psource; do
  [ -n "$pname" ] || { err "marketplace.json: a plugin entry has no name"; continue; }
  [ -n "$psource" ] || { err "marketplace.json: plugin '$pname' has no source"; continue; }
  dir="$ROOT/$psource"
  [ -d "$dir" ] || { err "marketplace.json: '$pname' source '$psource' is not a directory"; continue; }
  pjname=$(jq -r .name "$dir/.claude-plugin/plugin.json" 2>/dev/null || echo '')
  [ "$pjname" = "$pname" ] || err "marketplace.json: '$pname' name does not match plugin.json name '$pjname'"
done < <(jq -r '.plugins[] | [.name, .source] | @tsv' "$ROOT/.claude-plugin/marketplace.json")

# ------------------------------------------------------------ offline tsc
# Type-check the pure lib + test logic against a minimal stub of the
# claude-code / claude-code/testing APIs. This runs everywhere; it is NOT a
# substitute for `claude plugin validate` against the real declarations.
if command -v tsc >/dev/null 2>&1; then
  note "offline type-check (stubbed claude-code APIs)"
  ( cd "$ROOT" && tsc -p scripts/tsconfig.check.json ) || err "offline type-check failed"
else
  note "tsc not found; skipping offline type-check (install typescript ^5.4)"
  [ "$CI" = "1" ] && err "CI=1 requires tsc"
fi

# ------------------------------------------------- skill reference integrity
note "skill references resolve inside each mod"
for m in "${MODS[@]}"; do
  n="${m#$ROOT/mods/}"
  # SKILL.md must exist for every directory under skills/
  if [ -d "$m/skills" ]; then
    find "$m/skills" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r s; do
      [ -f "$s/SKILL.md" ] || { echo "FAIL: $n: skills/$(basename "$s") has no SKILL.md"; exit 1; }
    done || err "$n: a skills/ subdirectory is missing SKILL.md"
    # references mentioned in SKILL.md exist
    refs=$(grep -rhoE 'references/[A-Za-z0-9_./-]+\.md' "$m/skills" --include='*.md' | sort -u || true)
    for r in $refs; do
      found=0
      while IFS= read -r s; do
        [ -f "$s/$r" ] && found=1 && break
      done < <(find "$m/skills" -mindepth 1 -maxdepth 1 -type d)
      [ "$found" = "1" ] || err "$n: broken skill reference $r"
    done
  fi
done

# --------------------------------------------------------- Claude CLI gates
if [ "$OFFLINE" = "1" ]; then
  note "Claude CLI not invoked: OFFLINE=1 so skipping validate/test"
elif command -v claude >/dev/null 2>&1; then
  note "Claude CLI found: validate every mod"
  for m in "${MODS[@]}"; do
    echo "=== claude plugin validate ${m#$ROOT/} ==="
    claude plugin validate "$m" || err "validate failed: ${m#$ROOT/}"
    if [ -d "$m/tests" ]; then
      echo "=== claude plugin test ${m#$ROOT/} ==="
      claude plugin test "$m" || err "tests failed: ${m#$ROOT/}"
    fi
  done
  note "marketplace validation"
  claude plugin validate "$ROOT" || err "marketplace validation failed"
else
  note "Claude CLI not found; skipping validate/test (run with the CLI installed before release)"
fi

if [ $fail -eq 0 ]; then
  echo "All checks passed."
else
  echo "Some checks failed."
  exit 1
fi
