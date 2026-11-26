/**
 * Runs the packages/core unit tests. Each test file is bundled with esbuild, which is already a
 * dev dependency, and executed by Node's built-in test runner. No test framework is added.
 *
 *   node packages/tooling/test-core.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { ROOT, run } from './lib/repo.mjs'

const TEST_DIR = join(ROOT, 'packages', 'core', 'test')
const tests = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()

const outDir = mkdtempSync(join(tmpdir(), 'core-tests-'))
try {
  await build({
    entryPoints: tests.map((name) => join(TEST_DIR, name)),
    outdir: outDir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  })
  const bundles = readdirSync(outDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(outDir, name))
  const result = spawnSync(process.execPath, ['--test', ...bundles], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) process.stdout.write(`${result.stdout}${result.stderr}`)
  const summary = /^# pass (\d+)$/m.exec(result.stdout ?? '')
  const ok = result.status === 0
  process.exitCode = run(
    `unit tests packages/core (${tests.length} files, ${summary?.[1] ?? '?'} passing)`,
    { ok },
  )
    ? 0
    : 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
