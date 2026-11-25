/**
 * Type-checks the shared core and every mod with the engine declarations, strictly.
 * Exits non-zero if any project fails.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_DIR, ENGINE_TYPES_FILE, ROOT, listMods, run } from './lib/repo.mjs'

if (!existsSync(ENGINE_TYPES_FILE)) {
  process.stderr.write('engine declarations missing: run `pnpm types:sync` first\n')
  process.exit(1)
}

const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const projects = [
  { label: 'packages/core', project: join(CORE_DIR, 'tsconfig.json') },
  ...listMods().map((mod) => ({
    label: `mods/${mod.name}`,
    project: join(mod.dir, 'tsconfig.json'),
  })),
]

let allOk = true
for (const { label, project } of projects) {
  if (!existsSync(project)) {
    allOk = run(`${label} (no tsconfig.json)`, { ok: false }) && allOk
    continue
  }
  const result = spawnSync(tsc, ['-p', project], { cwd: ROOT, encoding: 'utf8' })
  const ok = result.status === 0
  if (!ok) process.stdout.write(`${result.stdout}${result.stderr}`)
  allOk = run(`tsc ${label}`, { ok }) && allOk
}

process.exit(allOk ? 0 : 1)
