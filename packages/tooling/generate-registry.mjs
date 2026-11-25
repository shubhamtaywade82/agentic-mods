/**
 * Generates the registry and the marketplace from the mods' own manifests, and validates every
 * preset against the native list. Fails if a preset names a mod that does not exist.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { listMods, readJson, ROOT, run } from './lib/repo.mjs'
import { VENDORED } from './lib/vendored.mjs'

const pluginManifest = z.object({
  name: z.string().regex(/^[a-z0-9-]{2,40}$/),
  version: z.string(),
  description: z.string().min(1),
  types: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
})

const preset = z.object({
  id: z.string(),
  description: z.string(),
  mods: z.array(z.string()).min(1),
  config: z.record(z.string(), z.unknown()).optional(),
})

const mods = listMods()
const vendored = VENDORED.filter(name => existsSync(join(ROOT, 'plugins', name, '.claude-plugin', 'plugin.json')))
const names = new Set([...mods.map(mod => mod.name), ...vendored])
let allOk = true

const sources = [...mods.map(mod => ({ name: mod.name, dir: mod.dir, base: 'mods' })), ...vendored.map(name => ({ name, dir: join(ROOT, 'plugins', name), base: 'plugins' }))]
const manifests = sources.map(source => {
  const parsed = pluginManifest.safeParse(readJson(join(source.dir, '.claude-plugin', 'plugin.json')))
  if (!parsed.success) {
    process.stdout.write(`${parsed.error.issues.map(issue => issue.message).join('; ')}\n`)
    allOk = false
  }
  return { ...(parsed.success ? parsed.data : { name: source.name, version: '?', description: '' }), path: `${source.base}/${source.name}` }
})

const presetDir = join(ROOT, 'presets')
const presets = existsSync(presetDir)
  ? readdirSync(presetDir).filter(file => file.endsWith('.json')).sort()
  : []
for (const file of presets) {
  const parsed = preset.safeParse(readJson(join(presetDir, file)))
  if (!parsed.success) {
    allOk = run(`preset ${file} (schema)`, { ok: false, note: parsed.error.issues[0]?.message }) && allOk
    continue
  }
  const unknown = parsed.data.mods.filter(name => !names.has(name))
  allOk = run(`preset ${parsed.data.id}`, { ok: unknown.length === 0, note: unknown.length ? `unknown: ${unknown.join(', ')}` : `${parsed.data.mods.length} mods` }) && allOk
}

mkdirSync(join(ROOT, 'registry'), { recursive: true })
writeFileSync(join(ROOT, 'registry', 'native-mods.json'), `${JSON.stringify({ mods: manifests }, null, 2)}\n`)

mkdirSync(join(ROOT, '.claude-plugin'), { recursive: true })
const marketplace = {
  name: 'agentic-mods',
  owner: { name: 'shubhamtaywade82' },
  metadata: { description: 'Claude Code mods for engineering workflows: safety, verification, governance and delivery workflows.' },
  plugins: manifests.map(item => ({
    name: item.name,
    source: `./${item.path}`,
    description: item.description,
    version: item.version,
  })),
}
writeFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`)

writeFileSync(
  join(ROOT, 'registry', 'compatibility.json'),
  `${JSON.stringify(
    {
      claudeCode: '2.1.332',
      declarations: 'plugin-authoring skill, types/claude-code.d.ts for 2.1.332',
      checks: ['typecheck (TypeScript 7.0.2, strict)', 'build (esbuild 0.28.2, bare-import check)', 'claude plugin validate'],
      notChecked: ['runtime behaviour in the app', 'unit tests (deferred)'],
    },
    null,
    2,
  )}\n`,
)

allOk = run(`registry written: ${manifests.length} mods, ${presets.length} presets`, { ok: true }) && allOk
process.exit(allOk ? 0 : 1)
