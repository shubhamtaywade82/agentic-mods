/**
 * Scaffolds a new mod: manifest, hooks manifest, source, tsconfig and, with --state, a contract.
 *
 *   pnpm create-mod <name> "<one-line description>" [--state]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODS_DIR } from './lib/repo.mjs'

const [name, description, ...flags] = process.argv.slice(2)
const withState = flags.includes('--state')

if (!name || !/^[a-z][a-z0-9-]{1,40}$/.test(name)) {
  process.stderr.write('usage: pnpm create-mod <kebab-name> "<description>" [--state]\n')
  process.exit(1)
}
if (!description) {
  process.stderr.write('a one-line description is required\n')
  process.exit(1)
}

const dir = join(MODS_DIR, name)
if (existsSync(dir)) {
  process.stderr.write(`mods/${name} already exists\n`)
  process.exit(1)
}

const pluginJson = {
  name,
  version: '0.1.0',
  description,
  ...(withState ? { types: './types/index.d.ts' } : {}),
}

const register = `import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    \$.ui.status(undefined)
    return next(e)
  })
}
`

const stateContract = `export type ${toPascal(name)}State = {
  // Declare each value this mod keeps in $.state here, then add it to PluginState below.
}

declare module 'claude-code' {
  interface PluginState {
    '${name}': {
      // key: Shaped<ValueType>
    }
  }
}
`

mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
mkdirSync(join(dir, 'hooks'), { recursive: true })
mkdirSync(join(dir, 'src'), { recursive: true })
writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginJson, null, 2)}\n`)
writeFileSync(
  join(dir, 'hooks', 'hooks.json'),
  `${JSON.stringify({ modules: ['./register.js'] }, null, 2)}\n`,
)
writeFileSync(join(dir, 'src', 'register.tsx'), register)
writeFileSync(
  join(dir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      extends: '../../tsconfig.mod.json',
      include: ['src', 'types', '../../packages/tooling/engine-types/claude-code.d.ts', '../../packages/core/src'],
      compilerOptions: { paths: { '@agentic-mods/core': ['../../packages/core/src/index.ts'] } },
    },
    null,
    2,
  )}\n`,
)
if (withState) {
  mkdirSync(join(dir, 'types'), { recursive: true })
  writeFileSync(join(dir, 'types', 'index.d.ts'), stateContract)
}

process.stdout.write(`created mods/${name}\nnext: pnpm build && pnpm typecheck && pnpm validate\n`)

function toPascal(kebab) {
  return kebab
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
