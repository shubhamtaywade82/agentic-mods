/**
 * Bundles each mod's source into hooks/register.js. Everything from packages/core is inlined.
 * The only import left is 'claude-code', which the engine provides at run time.
 *
 * The build fails if a bundle would contain a dependency from node_modules or any bare import
 * other than 'claude-code', because a hooks module has no npm resolution.
 */
import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CORE_ENTRY, ROOT, listMods, run } from './lib/repo.mjs'

const ALLOWED_BARE = new Set(['claude-code'])

let allOk = true
for (const mod of listMods()) {
  const entry = join(mod.dir, 'src', 'register.tsx')
  const outfile = join(mod.dir, 'hooks', 'register.js')
  if (!existsSync(entry)) {
    allOk = run(`mods/${mod.name} (missing src/register.tsx)`, { ok: false }) && allOk
    continue
  }
  mkdirSync(join(mod.dir, 'hooks'), { recursive: true })
  try {
    const result = await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2023',
      jsx: 'transform',
      jsxFactory: 'h',
      jsxFragment: 'Fragment',
      external: [...ALLOWED_BARE],
      alias: { '@agentic-mods/core': CORE_ENTRY },
      legalComments: 'none',
      metafile: true,
      logLevel: 'silent',
      write: true,
      charset: 'utf8',
    })
    const inputs = Object.keys(result.metafile.inputs)
    const npmInputs = inputs.filter(input => input.includes('node_modules'))
    const outsideRoot = inputs.filter(input => input.startsWith('..'))
    const imports = Object.values(result.metafile.outputs).flatMap(output =>
      output.imports.filter(item => item.external).map(item => item.path),
    )
    const badImports = [...new Set(imports)].filter(path => !ALLOWED_BARE.has(path))
    const problems = [
      ...npmInputs.map(input => `npm input ${input}`),
      ...badImports.map(path => `bare import ${path}`),
      ...outsideRoot.map(input => `input outside repo ${input}`),
    ]
    const size = Object.values(result.metafile.outputs).reduce((sum, out) => sum + out.bytes, 0)
    const ok = problems.length === 0
    if (!ok) process.stdout.write(`  ${problems.join('\n  ')}\n`)
    allOk =
      run(`build mods/${mod.name} -> ${relative(ROOT, outfile)}`, {
        ok,
        note: `${Math.round(size / 1024)} KiB`,
      }) && allOk
  } catch (error) {
    process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`)
    allOk = run(`build mods/${mod.name}`, { ok: false }) && allOk
  }
}

process.exit(allOk ? 0 : 1)
