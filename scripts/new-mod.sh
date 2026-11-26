#!/usr/bin/env bash
# LEGACY: this follows the older hook layout and does not update the native trust registry. Use
# `pnpm create-mod` (packages/tooling/create-mod.mjs) instead.
# Scaffold a new mod from mods/mod-template.
# Usage: bash scripts/new-mod.sh <new-mod-name>
#   - copies mods/mod-template, renames the plugin and commands,
#   - registers it in .claude-plugin/marketplace.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "Usage: bash scripts/new-mod.sh <new-mod-name> [description]"; exit 1
fi

NAME="$1"
case "$NAME" in
  claude-*) echo "Mod names must not start with 'claude-'" >&2; exit 1 ;;
  *[!a-z0-9-]*) echo "Use lowercase letters, digits and hyphens only" >&2; exit 1 ;;
esac

# Optional one-line description passed as the second argument; defaults to a
# placeholder the author should replace before release.
DESC="${2:-TODO: describe what this mod does}"

SRC="$ROOT/mods/mod-template"
DEST="$ROOT/mods/$NAME"
[ -d "$DEST" ] && { echo "mods/$NAME already exists" >&2; exit 1; }

cp -r "$SRC" "$DEST"
rm -rf "$DEST/.claude-plugin/types" # never ship generated types

# Rename the plugin, its commands and the template references.
sed -i.bak "s/mod-template/$NAME/g" \
  "$DEST/.claude-plugin/plugin.json" \
  "$DEST/hooks/hooks.json" \
  "$DEST/hooks/register.ts" \
  "$DEST/README.md" \
  "$DEST/tests/mod-template.test.ts" 2>/dev/null || true
rm -f "$DEST"/{.claude-plugin/plugin.json,hooks/hooks.json,hooks/register.ts,README.md,tests/mod-template.test.ts}.bak
mv "$DEST/tests/mod-template.test.ts" "$DEST/tests/$NAME.test.ts"

# Register in the marketplace manifest. Schema: plugins[] = { name, source, description }.
jq --arg name "$NAME" \
   --arg source "./mods/$NAME" \
   --arg desc "$DESC" \
   '.plugins += [{ name: $name, source: $source, description: $desc }]' \
  "$ROOT/.claude-plugin/marketplace.json" > "$ROOT/.claude-plugin/marketplace.json.tmp" \
  && mv "$ROOT/.claude-plugin/marketplace.json.tmp" "$ROOT/.claude-plugin/marketplace.json"

echo "Created mods/$NAME from mod-template."
echo "Next: implement hooks/register.ts + hooks/lib/, update tests, then:"
echo "  claude --plugin-dir ./mods/$NAME"
echo "  bash scripts/check.sh"
