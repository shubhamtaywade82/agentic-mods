/**
 * Copies built mods into the session's dev-mods folder, where the engine loads and hot-reloads them.
 * Only plugin files are copied: sources, tests and per-mod tsconfig stay in the repository.
 *
 * The first write into that folder makes the engine ask the person to turn the mods on.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEV_MODS_ROOT, listMods, ROOT, run } from './lib/repo.mjs'
import { VENDORED } from './lib/vendored.mjs'

const EXCLUDED = new Set(['src', 'tsconfig.json', 'node_modules', '.claude-plugin/types'])

mkdirSync(DEV_MODS_ROOT, { recursive: true })
let allOk = true

// Vendored plugins load their TypeScript directly and need no build step.
for (const name of VENDORED) {
  const from = join(ROOT, 'plugins', name)
  const target = join(DEV_MODS_ROOT, name)
  if (!existsSync(join(from, '.claude-plugin', 'plugin.json'))) {
    allOk = run(`deploy plugins/${name} (missing)`, { ok: false }) && allOk
    continue
  }
  rmSync(target, { recursive: true, force: true })
  cpSync(from, target, {
    recursive: true,
    filter: source => {
      const rel = source.slice(from.length + 1).replace(/\\/g, '/')
      return rel === '' || !(rel === '.claude-plugin/types' || rel.startsWith('.claude-plugin/types/'))
    },
  })
  allOk = run(`deploy plugins/${name} -> ${target}`, { ok: true }) && allOk
}

for (const mod of listMods()) {
  if (!existsSync(join(mod.dir, 'hooks', 'register.js'))) {
    allOk = run(`deploy mods/${mod.name} (not built)`, { ok: false }) && allOk
    continue
  }
  const target = join(DEV_MODS_ROOT, mod.name)
  rmSync(target, { recursive: true, force: true })
  cpSync(mod.dir, target, {
    recursive: true,
    filter: source => {
      const rel = source.slice(mod.dir.length + 1).replace(/\\/g, '/')
      if (rel === '') return true
      return ![...EXCLUDED].some(excluded => rel === excluded || rel.startsWith(`${excluded}/`))
    },
  })
  allOk = run(`deploy mods/${mod.name} -> ${target}`, { ok: true }) && allOk
}

process.stdout.write(
  'If the engine asks "Turn on the mods Claude writes in this session?", answer "Turn them on".\n',
)
process.exit(allOk ? 0 : 1)
