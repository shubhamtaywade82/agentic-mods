import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root, found from this file's location. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const MODS_DIR = join(ROOT, 'mods')
export const CORE_DIR = join(ROOT, 'packages', 'core')
export const CORE_ENTRY = join(CORE_DIR, 'src', 'index.ts')
export const ENGINE_TYPES_DIR = join(ROOT, 'packages', 'tooling', 'engine-types')
export const ENGINE_TYPES_FILE = join(ENGINE_TYPES_DIR, 'claude-code.d.ts')

/** The session folder the engine loads mods from, set by the plugin-authoring skill. */
export const DEV_MODS_ROOT = join(
  homedir(),
  '.claude',
  'dev-mods',
  'a7858f5d-5427-555a-924f-8906bec2aa00',
)

/** Every mod folder: a directory under mods/ that has a plugin manifest. */
export function listMods() {
  if (!existsSync(MODS_DIR)) return []
  return readdirSync(MODS_DIR)
    .filter(name => statSync(join(MODS_DIR, name)).isDirectory())
    .filter(name => existsSync(join(MODS_DIR, name, '.claude-plugin', 'plugin.json')))
    .sort()
    .map(name => ({ name, dir: join(MODS_DIR, name) }))
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function run(label, outcome) {
  const mark = outcome.ok ? 'ok  ' : 'FAIL'
  process.stdout.write(`${mark} ${label}${outcome.note ? `  (${outcome.note})` : ''}\n`)
  return outcome.ok
}
