/**
 * Runs `claude plugin validate` on every mod folder and every vendored plugin. Validation reads each
 * manifest and its hooks module the way the engine does, and refuses what the engine would refuse.
 *
 * This is the check that replaces tests for now. It does not run hooks.
 *
 *   node packages/tooling/validate-mods.mjs             full: needs the Claude Code CLI
 *   node packages/tooling/validate-mods.mjs --offline   the checks that need no CLI; the CLI
 *                                                       validation is skipped and must run elsewhere
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listMods, ROOT, run } from './lib/repo.mjs'
import { VENDORED } from './lib/vendored.mjs'
import { BUILTIN_COMMANDS, commandNamesIn, unhandledCommandsIn } from './lib/builtin-commands.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/** The native list in packages/core/src/native.ts must name exactly the mod folders. */
function nativeNames() {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'src', 'native.ts'),
    'utf8',
  )
  const start = source.indexOf('NATIVE_MODS')
  const block = source.slice(start, source.indexOf('\n]', start))
  return [...block.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1])
}

const claude = process.env.CLAUDE_BIN ?? 'claude'
const offline = process.argv.includes('--offline')
let allOk = true

const vendoredSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'src', 'native.ts'),
  'utf8',
)
const vendoredAfter = vendoredSource.slice(vendoredSource.indexOf('VENDORED_PLUGINS'))
const vendoredListed = [
  ...vendoredAfter
    .slice(vendoredAfter.indexOf('= ['), vendoredAfter.indexOf('\n]'))
    .matchAll(/'([a-z0-9-]+)'/g),
].map((match) => match[1])
allOk =
  run('vendored list matches lib/vendored.mjs', {
    ok: JSON.stringify(vendoredListed) === JSON.stringify(VENDORED),
  }) && allOk
const collisions = []
for (const mod of listMods()) {
  const source = readFileSync(join(mod.dir, 'src', 'register.tsx'), 'utf8')
  for (const name of commandNamesIn(source))
    if (BUILTIN_COMMANDS.has(name)) collisions.push(`${mod.name}: /${name}`)
  for (const name of unhandledCommandsIn(source))
    collisions.push(`${mod.name}: /${name} has no handler`)
}
allOk =
  run('commands: no built-in shadowing, every command answered', {
    ok: collisions.length === 0,
    note: collisions.join(', ') || undefined,
  }) && allOk
const folders = listMods().map((mod) => mod.name)
const listed = nativeNames()
const missing = folders.filter((name) => !listed.includes(name))
const stale = listed.filter((name) => !folders.includes(name))
allOk =
  run('native list matches mods/', {
    ok: missing.length === 0 && stale.length === 0,
    note:
      [...missing.map((n) => `add ${n}`), ...stale.map((n) => `remove ${n}`)].join(', ') ||
      undefined,
  }) && allOk

/** Runs `claude plugin validate <dir>` and reports the result under `label`. */
function validateWithCli(label, dir) {
  const result = spawnSync(claude, ['plugin', 'validate', dir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.error) {
    return run(label, { ok: false, note: `could not run ${claude}: ${result.error.message}` })
  }
  const ok = result.status === 0
  if (!ok) process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  return run(label, { ok })
}

if (offline) {
  // Without the CLI these cannot run. They are not reported as passing: the full validation must
  // run where the CLI is installed (the claude job in .github/workflows/check.yml).
  process.stdout.write(
    'skip  claude plugin validate for mods and vendored plugins (offline: CLI not used)\n',
  )
} else {
  for (const mod of listMods()) {
    if (!existsSync(join(mod.dir, 'hooks', 'register.js'))) {
      allOk = run(`validate mods/${mod.name} (not built: run pnpm build)`, { ok: false }) && allOk
      continue
    }
    allOk = validateWithCli(`validate mods/${mod.name}`, mod.dir) && allOk
  }

  // Vendored plugins load their TypeScript directly: validate them in place, with no build step.
  for (const name of VENDORED) {
    const dir = join(ROOT, 'plugins', name)
    if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) {
      allOk = run(`validate plugins/${name} (missing)`, { ok: false }) && allOk
      continue
    }
    allOk = validateWithCli(`validate plugins/${name} (vendored)`, dir) && allOk
  }
}

process.exit(allOk ? 0 : 1)
