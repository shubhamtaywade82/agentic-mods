/**
 * Runs the golden tasks through the Agentic SDLC Kit's orchestration loop and reports what happened: did
 * the run converge, how many attempts each phase took, how many tool calls were denied, and the tokens and
 * time it used. A live run starts a Claude Code agent for each task and spends model calls. Credentials
 * come from Claude Code itself. --dry-run only prepares each project and starts its feature, with no agent.
 *
 *   node packages/tooling/measure-kit-loop.mjs [--dry-run] [--task <name>] [--kit <command>]
 *
 * --kit defaults to KIT_BIN, then `kit` on PATH. The kit must be 0.9.1 or later.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { ROOT, run } from './lib/repo.mjs'

const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const dryRun = args.includes('--dry-run')
const only = flag('--task')
const kit = flag('--kit') ?? process.env.KIT_BIN ?? 'kit'
const GOLDEN = join(ROOT, 'measurements', 'kit-loop', 'golden')
const RUN_TIMEOUT_MS = 40 * 60 * 1000

// The summary is pure TypeScript in core. Bundle it so this script can use it without a build step.
const bundleDir = mkdtempSync(join(tmpdir(), 'kit-measure-bundle-'))
await build({
  entryPoints: [join(ROOT, 'packages', 'core', 'src', 'kit-measure.ts')],
  outfile: join(bundleDir, 'kit-measure.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})
const { summarizeKitRun, renderKitRunMetrics } = await import(join(bundleDir, 'kit-measure.mjs'))

function git(cwd, gitArgs) {
  execFileSync('git', gitArgs, { cwd, stdio: 'pipe' })
}

function kitRun(cwd, kitArgs) {
  const result = spawnSync(kit, kitArgs, {
    cwd,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ''),
  }
}

/** Execution records the kit stored for this project. Unreadable files are skipped, not guessed at. */
function recordsIn(projectDir) {
  const dir = join(projectDir, '.ai-kit', 'state', 'agent-executions')
  if (!existsSync(dir)) return []
  const records = []
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    try {
      records.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
    } catch {
      // A record the kit wrote but this script cannot read is left out, and the summary says so only
      // through its counts. Nothing is invented for it.
    }
  }
  return records
}

const tasks = existsSync(GOLDEN)
  ? readdirSync(GOLDEN)
      .filter((name) => !name.startsWith('.') && (!only || name === only))
      .sort()
  : []
if (tasks.length === 0) {
  process.stderr.write(`no golden tasks found under ${GOLDEN}\n`)
  process.exit(1)
}

let allOk = true
for (const name of tasks) {
  const dir = mkdtempSync(join(tmpdir(), `golden-${name}-`))
  try {
    cpSync(join(GOLDEN, name), dir, { recursive: true })
    git(dir, ['init', '-q', '-b', 'main'])
    git(dir, ['add', '-A'])
    git(dir, [
      '-c',
      'user.name=measure-kit-loop',
      '-c',
      'user.email=measure-kit-loop@localhost',
      'commit',
      '-q',
      '-m',
      `golden task ${name}`,
    ])
    const featureId = readdirSync(join(dir, 'docs', 'plans'))[0]
    if (featureId === undefined) throw new Error(`${name}: no docs/plans/<id>/plan.json`)

    if (dryRun) {
      const start = kitRun(dir, ['feature', featureId, 'start'])
      const next = kitRun(dir, ['next', featureId, '--json'])
      const ok = start.exitCode === 0 && next.exitCode === 0
      const action = ok ? JSON.parse(next.stdout) : null
      allOk =
        run(`${name}: prepared, kit starts ${featureId}`, {
          ok,
          note: ok
            ? `next action ${action.requiredAction}`
            : `${start.stderr || start.stdout}${next.stderr}`.trim().slice(0, 300),
        }) && allOk
      continue
    }

    const started = Date.now()
    const result = kitRun(dir, [
      'feature',
      featureId,
      'run',
      '--json',
      '--max-duration-ms',
      String(15 * 60 * 1000),
    ])
    const elapsedMs = Date.now() - started
    if (result.exitCode === 3 || result.stdout.trim() === '') {
      allOk =
        run(`${name}: kit did not run`, { ok: false, note: result.stderr.trim().slice(0, 300) }) &&
        allOk
      continue
    }
    let report
    try {
      report = JSON.parse(result.stdout)
    } catch {
      // Show what the kit printed, so a failed run can be read without re-running it.
      const shown = `exit ${result.exitCode}; stdout: ${result.stdout.slice(0, 300)}; stderr: ${result.stderr.slice(0, 300)}`
      allOk = run(`${name}: kit output is not a run report`, { ok: false, note: shown }) && allOk
      continue
    }
    const metrics = summarizeKitRun(report, recordsIn(dir))
    process.stdout.write(`${renderKitRunMetrics(metrics)}\n`)
    process.stdout.write(
      `- wall clock: ${Math.round(elapsedMs / 1000)} s (measured by this script)\n\n`,
    )
    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n\n`)
    // A run that did not converge is a measurement, not a failure of this script.
    allOk =
      run(`${name}: measured (${metrics.converged ? 'converged' : metrics.status})`, {
        ok: true,
      }) && allOk
  } catch (err) {
    allOk =
      run(`${name}: ${err instanceof Error ? err.message : String(err)}`, { ok: false }) && allOk
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

rmSync(bundleDir, { recursive: true, force: true })
process.exit(allOk ? 0 : 1)
