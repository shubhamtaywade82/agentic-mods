/**
 * Live smoke test: loads each mod (with its dependencies) into a real headless Claude Code session
 * in a throwaway git repository, runs every command it registers, and fails when the engine did not
 * load the hooks module, skipped a hook, or the command answered nothing.
 * Commands answered by a mod need no model call, so this costs no tokens.
 *
 * Usage: node packages/tooling/smoke-live.mjs [mod ...]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commandNamesIn } from './lib/builtin-commands.mjs'
import { ROOT, listMods, readJson, run } from './lib/repo.mjs'

const COMMAND_TIMEOUT_MS = 120_000
// A command-free mod still needs a session; /cost is answered locally, with no model call.
const LOAD_ONLY_COMMAND = 'cost'

function pluginDir(name) {
  const candidates = [join(ROOT, 'mods', name), join(ROOT, 'plugins', name)]
  return candidates.find((dir) => existsSync(join(dir, '.claude-plugin', 'plugin.json'))) ?? null
}

/** The mod's folder plus every dependency's, depth first, without repeats. */
function withDependencies(name, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const dir = pluginDir(name)
  if (dir === null) throw new Error(`smoke-live: no plugin folder for dependency "${name}"`)
  const deps = readJson(join(dir, '.claude-plugin', 'plugin.json')).dependencies ?? []
  const names = deps.map((dep) => (typeof dep === 'string' ? dep : dep.name))
  return [...names.flatMap((dep) => withDependencies(dep, seen)), dir]
}

function makeRepository() {
  const repo = mkdtempSync(join(tmpdir(), 'agentic-mods-live-'))
  spawnSync('git', ['init', '-q', repo])
  writeFileSync(join(repo, 'package.json'), '{ "name": "live-smoke", "version": "1.0.0" }\n')
  return repo
}

/** Runs one slash command headlessly; returns why it failed, or null. */
function runCommand(repo, mod, dirs, command) {
  const log = join(repo, `${mod}-${command}.log`)
  const argv = [
    ...dirs.flatMap((dir) => ['--plugin-dir', dir]),
    '--debug-file',
    log,
    '-p',
    `/${command}`,
  ]
  const result = spawnSync('claude', argv, {
    cwd: repo,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (result.error) return `could not run claude: ${result.error.message}`
  const debug = existsSync(log) ? readFileSync(log, 'utf8') : ''
  if (!debug.includes(`hooks module ${mod}@inline loaded`)) return 'hooks module did not load'
  const skipped = debug
    .split('\n')
    .find((line) => line.includes(`${mod}`) && /hook (was )?skipped|did not load/.test(line))
  if (skipped) return skipped.replace(/^.*\[DEBUG\] /, '')
  if (result.status !== 0) return `exit ${result.status}: ${result.stderr.trim().slice(-200)}`
  if (result.stdout.trim() === '') return 'answered nothing'
  return null
}

function smokeMod(repo, mod) {
  const source = readFileSync(join(mod.dir, 'src', 'register.tsx'), 'utf8')
  const commands = commandNamesIn(source)
  const dirs = withDependencies(mod.name)
  let allOk = true
  for (const command of commands.length > 0 ? commands : [LOAD_ONLY_COMMAND]) {
    const failure = runCommand(repo, mod.name, dirs, command)
    allOk =
      run(`live ${mod.name} /${command}`, { ok: failure === null, note: failure ?? undefined }) &&
      allOk
  }
  return allOk
}

const wanted = process.argv.slice(2)
const mods = listMods().filter((mod) => wanted.length === 0 || wanted.includes(mod.name))
const repo = makeRepository()
let allOk = true
try {
  for (const mod of mods) allOk = smokeMod(repo, mod) && allOk
} finally {
  rmSync(repo, { recursive: true, force: true })
}
process.exit(allOk ? 0 : 1)
