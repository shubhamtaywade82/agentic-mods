/**
 * The release gate: every check that can run, in order. Stops at the first failure so the earliest
 * problem is the one reported.
 *
 *   node packages/tooling/check.mjs             full gate; the strict typecheck needs engine declarations
 *   node packages/tooling/check.mjs --offline   every check that runs without an engine session (CI)
 *
 * When CI is set, generated files (hook bundles, registry, READMEs) must already match what is
 * committed: a drift is a failure, because the committed bundle is what users install.
 */
import { spawnSync } from 'node:child_process'
import { ROOT, run } from './lib/repo.mjs'

const offline = process.argv.includes('--offline')
const enforceDrift = Boolean(process.env.CI)

/** Each step is a command, or a function that returns true when it passes. */
const steps = [
  ...(offline
    ? []
    : [['typecheck (strict TypeScript)', ['node', 'packages/tooling/typecheck.mjs']]]),
  ['build (bundles, bare-import check)', ['node', 'packages/tooling/build-mods.mjs']],
  ...(enforceDrift ? [['hook bundles match source', () => noDrift('mods')]] : []),
  ['unit tests (packages/core)', ['node', 'packages/tooling/test-core.mjs']],
  ['lint (JavaScript tooling)', ['./node_modules/.bin/eslint', '.']],
  ['validate (engine validator, command checks)', ['node', 'packages/tooling/validate-mods.mjs']],
  ['registry, marketplace and READMEs', ['node', 'packages/tooling/generate-registry.mjs']],
  ...(enforceDrift
    ? [['registry and READMEs match committed', () => noDrift('registry', 'mods')]]
    : []),
  ...(offline ? [] : [['marketplace (engine validator)', ['claude', 'plugin', 'validate', '.']]]),
]

/** True when no tracked or untracked file under the given paths differs from the commit. */
function noDrift(...paths) {
  const result = spawnSync('git', ['status', '--porcelain', '--', ...paths], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.stdout.write(`${result.stderr}`)
    return false
  }
  const changed = result.stdout.trim()
  if (changed !== '') process.stdout.write(`generated files differ from the commit:\n${changed}\n`)
  return changed === ''
}

let allOk = true
for (const [label, step] of steps) {
  let ok
  if (typeof step === 'function') {
    ok = step()
  } else {
    const [command, ...args] = step
    const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 900_000 })
    ok = result.status === 0
    if (!ok) process.stdout.write(`${result.stdout}${result.stderr}`)
  }
  allOk = run(label, { ok }) && allOk
  if (!ok) break
}
process.exit(allOk ? 0 : 1)
