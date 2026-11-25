/**
 * Packs each built mod into dist/<name>.tgz with its plugin files only.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { listMods, ROOT, run } from './lib/repo.mjs'

const DIST = join(ROOT, 'dist')
mkdirSync(DIST, { recursive: true })
let allOk = true

for (const mod of listMods()) {
  if (!existsSync(join(mod.dir, 'hooks', 'register.js'))) {
    allOk = run(`package mods/${mod.name} (not built)`, { ok: false }) && allOk
    continue
  }
  const archive = join(DIST, `${mod.name}.tgz`)
  const result = spawnSync(
    'tar',
    [
      '-czf',
      archive,
      '--exclude=src',
      '--exclude=tsconfig.json',
      '--exclude=node_modules',
      '--exclude=.claude-plugin/types',
      '-C',
      join(ROOT, 'mods'),
      mod.name,
    ],
    { encoding: 'utf8' },
  )
  allOk = run(`package mods/${mod.name} -> dist/${mod.name}.tgz`, { ok: result.status === 0 }) && allOk
}

process.exit(allOk ? 0 : 1)
