/**
 * Copies the engine's TypeScript declarations for hooks modules into a gitignored folder so that
 * `typecheck` works from any checkout. The source is never edited.
 *
 * Search order:
 *  1. the newest plugin-authoring skill folder under /tmp/claude-*\/bundled-skills
 *  2. the engine-written declarations beside a loaded mod in the dev-mods folder
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEV_MODS_ROOT, ENGINE_TYPES_DIR, ENGINE_TYPES_FILE, listMods, ROOT } from './lib/repo.mjs'

function newestSkillDeclaration() {
  const bases = [
    join('/tmp', 'claude-0', 'bundled-skills'),
    join(tmpdir(), 'claude-0', 'bundled-skills'),
  ]
  const candidates = []
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const version of readdirSync(base)) {
      for (const hash of safeList(join(base, version))) {
        const file = join(base, version, hash, 'plugin-authoring', 'types', 'claude-code.d.ts')
        if (existsSync(file)) candidates.push({ file, mtime: statSync(file).mtimeMs })
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]?.file ?? null
}

function safeList(dir) {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory())
  } catch {
    return []
  }
}

function loadedModDeclaration() {
  if (!existsSync(DEV_MODS_ROOT)) return null
  for (const name of safeList(DEV_MODS_ROOT)) {
    const file = join(DEV_MODS_ROOT, name, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')
    if (existsSync(file)) return file
  }
  return null
}

const source = newestSkillDeclaration() ?? loadedModDeclaration()
if (source === null) {
  process.stderr.write(
    'No engine declarations found. Load the plugin-authoring skill in a Claude Code session, ' +
      'or load a mod once so the engine writes .claude-plugin/types/claude-code/index.d.ts.\n',
  )
  process.exit(1)
}
mkdirSync(ENGINE_TYPES_DIR, { recursive: true })
copyFileSync(source, ENGINE_TYPES_FILE)
process.stdout.write(`engine declarations synced from ${source}\n`)
process.stdout.write(`mods known to this checkout: ${listMods().length} (root ${ROOT})\n`)
