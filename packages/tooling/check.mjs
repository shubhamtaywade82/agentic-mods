/**
 * The release gate: every check that can run without a live session, in order. Stops at the first
 * failure so the earliest problem is the one reported.
 */
import { spawnSync } from 'node:child_process'
import { ROOT, run } from './lib/repo.mjs'

const steps = [
  ['typecheck (strict TypeScript)', ['node', 'packages/tooling/typecheck.mjs']],
  ['build (bundles, bare-import check)', ['node', 'packages/tooling/build-mods.mjs']],
  ['lint (JavaScript tooling)', ['./node_modules/.bin/eslint', '.']],
  ['validate (engine validator, command checks)', ['node', 'packages/tooling/validate-mods.mjs']],
  ['registry, marketplace and READMEs', ['node', 'packages/tooling/generate-registry.mjs']],
  ['marketplace (engine validator)', ['claude', 'plugin', 'validate', '.']],
]

let allOk = true
for (const [label, argv] of steps) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 900_000 })
  const ok = result.status === 0
  if (!ok) process.stdout.write(`${result.stdout}${result.stderr}`)
  allOk = run(label, { ok }) && allOk
  if (!ok) break
}
process.exit(allOk ? 0 : 1)
