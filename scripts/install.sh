#!/usr/bin/env bash
# LEGACY: this copies native mod folders without resolving dependencies and does not install the
# vendored plugins. Install with the marketplace instead (see README.md, "Install").
# Install mods from this library into a Claude Code plugin directory.
# Usage: bash scripts/install.sh <target-claude-dir> [--mod name1,name2 | --all]
#          --mod  comma-separated list of mod names (default: all)
#          --all  same as listing every mod
#        DRY=1 prints the plan without copying.
#
# Target is a directory containing plugin folders, e.g. ~/.claude/plugins or
# a project .claude/plugins. Each mod is copied as <target>/<mod-name>/.
# Re-running never overwrites an existing mod; use --force to replace it.
# Uninstall: bash scripts/install.sh <target> --uninstall name1,name2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKET="$ROOT/.claude-plugin/marketplace.json"

TARGET=""; MODS=""; ALL=0; UNINSTALL=0; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mod) MODS="${2:-}"; shift 2 ;;
    --mod=*) MODS="${1#*=}"; shift ;;
    --all) ALL=1; shift ;;
    --uninstall) UNINSTALL=1; MODS="${2:-}"; shift 2 ;;
    --uninstall=*) UNINSTALL=1; MODS="${1#*=}"; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || { echo "Usage: bash scripts/install.sh <target-dir> [--mod a,b | --all] [--force]"; exit 1; }
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

# Resolve the mod list. Marketplace schema: plugins[] = { name, source, ... };
# we install by the plugin name (which matches its directory under mods/).
declare -a SELECTED=()
if [ "$ALL" = "1" ] || { [ -z "$MODS" ] && [ "$UNINSTALL" = "0" ]; }; then
  while IFS= read -r pname; do
    [ -n "$pname" ] && SELECTED+=("$pname")
  done < <(jq -r '.plugins[].name' "$MARKET")
else
  IFS=',' read -ra parts <<< "$MODS"
  known=$(jq -r '.plugins[].name' "$MARKET" | paste -sd ',' -)
  for p in "${parts[@]}"; do
    [ -n "${p// /}" ] || continue
    p="$(echo "$p" | xargs)"
    [ -d "$ROOT/mods/$p" ] || { echo "Unknown mod: $p (in marketplace: $known)" >&2; exit 1; }
    SELECTED+=("$p")
  done
fi
[ ${#SELECTED[@]} -gt 0 ] || { echo "No mods selected."; exit 1; }

if [ "$UNINSTALL" = "1" ]; then
  for m in "${SELECTED[@]}"; do
    if [ -d "$TARGET/$m" ]; then
      [ "${DRY:-0}" = "1" ] && { echo "would remove: $TARGET/$m"; continue; }
      rm -rf "$TARGET/$m"
      echo "removed: $TARGET/$m"
    else
      echo "not installed: $m"
    fi
  done
  exit 0
fi

# Third-party confirmation (this library is community code, not Anthropic's).
if [ "${ASSUME_YES:-0}" != "1" ]; then
  echo "About to install into: $TARGET"
  printf 'mods: %s\n' "${SELECTED[*]}"
  read -r -p "These are third-party mods that run with your permissions. Continue? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "Aborted."; exit 1 ;; esac
fi

for m in "${SELECTED[@]}"; do
  dst="$TARGET/$m"
  if [ -d "$dst" ] && [ "$FORCE" != "1" ]; then
    echo "skip (exists): $m  (use --force to replace)"
    continue
  fi
  [ "${DRY:-0}" = "1" ] && { echo "would install: $m -> $dst"; continue; }
  [ -d "$dst" ] && rm -rf "$dst"
  mkdir -p "$dst"
  # Copy the mod only; never generated types or node_modules.
  (cd "$ROOT/mods/$m" && tar cf - --exclude='.claude-plugin/types' --exclude='node_modules' .) | (cd "$dst" && tar xf -)
  echo "installed: $m -> $dst"
done
echo "Done. Start Claude Code and check /plugin -> Installed."
