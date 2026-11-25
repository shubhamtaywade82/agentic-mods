/**
 * Runs `claude plugin validate` on every mod folder. Validation reads each manifest and its
 * hooks module the way the engine does, and refuses what the engine would refuse.
 *
 * This is the check that replaces tests for now. It does not run hooks.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listMods, ROOT, run } from './lib/repo.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/** The native list in packages/core/src/native.ts must name exactly the mod folders. */
function nativeNames() {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'src', 'native.ts'), 'utf8')
  const start = source.indexOf('NATIVE_MODS')
  const block = source.slice(start, source.indexOf('\n]', start))
  return [...block.matchAll(/'([a-z0-9-]+)'/g)].map(match => match[1])
}

const claude = process.env.CLAUDE_BIN ?? 'claude'
let allOk = true

const folders = listMods().map(mod => mod.name)
const listed = nativeNames()
const missing = folders.filter(name => !listed.includes(name))
const stale = listed.filter(name => !folders.includes(name))
allOk = run('native list matches mods/', { ok: missing.length === 0 && stale.length === 0, note: [...missing.map(n => `add ${n}`), ...stale.map(n => `remove ${n}`)].join(', ') || undefined }) && allOk

for (const mod of listMods()) {
  const hooks = join(mod.dir, 'hooks', 'register.js')
  if (!existsSync(hooks)) {
    allOk = run(`validate mods/${mod.name} (not built: run pnpm build)`, { ok: false }) && allOk
    continue
  }
  const result = spawnSync(claude, ['plugin', 'validate', mod.dir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.error) {
    allOk = run(`validate mods/${mod.name}`, { ok: false, note: result.error.message }) && allOk
    continue
  }
  const ok = result.status === 0
  if (!ok) process.stdout.write(`${result.stdout}${result.stderr}`)
  allOk = run(`validate mods/${mod.name}`, { ok }) && allOk
}

process.exit(allOk ? 0 : 1)
