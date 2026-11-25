/**
 * Vendors the runtime plugins of agentic-sdlc-kit into plugins/, pinned to a commit. Tests, test
 * configuration and the engine-written declarations are left out: the source repository keeps them.
 *
 *   node packages/tooling/sync-sdlc-kit.mjs <path to a clone of agentic-sdlc-kit>
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, run } from './lib/repo.mjs'
import { VENDORED } from './lib/vendored.mjs'

const EXCLUDED = new Set(['tests', 'vitest.config.ts', 'package.json', 'tsconfig.json', 'node_modules', '.claude-plugin/types'])

const source = process.argv[2]
if (!source || !existsSync(join(source, 'plugins'))) {
  process.stderr.write('usage: node packages/tooling/sync-sdlc-kit.mjs <clone of agentic-sdlc-kit>\n')
  process.exit(1)
}

const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const remote = execFileSync('git', ['-C', source, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()
let allOk = true

for (const name of VENDORED) {
  const from = join(source, 'plugins', name)
  const to = join(ROOT, 'plugins', name)
  if (!existsSync(from)) {
    allOk = run(`vendor plugins/${name} (missing in source)`, { ok: false }) && allOk
    continue
  }
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, {
    recursive: true,
    filter: item => {
      const rel = item.slice(from.length + 1).replace(/\\/g, '/')
      if (rel === '') return true
      return ![...EXCLUDED].some(excluded => rel === excluded || rel.startsWith(`${excluded}/`))
    },
  })
  allOk = run(`vendor plugins/${name} @ ${commit.slice(0, 7)}`, { ok: true }) && allOk
}

writeFileSync(
  join(ROOT, 'plugins', 'PROVENANCE.json'),
  `${JSON.stringify({ source: remote, commit, plugins: VENDORED, licence: 'MIT', excluded: ['tests', 'vitest.config.ts', 'package.json', 'tsconfig.json', '.claude-plugin/types'] }, null, 2)}\n`,
)
process.exit(allOk ? 0 : 1)
