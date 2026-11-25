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

const claude = process.env.CLAUDE_BIN ?? 'claude'
let allOk = true

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
