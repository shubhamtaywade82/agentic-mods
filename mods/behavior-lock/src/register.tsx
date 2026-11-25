import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  type ExportEntry,
  diffSurface,
  extractSurface,
  normalizePath,
  stateRelativePath,
  truncate,
} from '@agentic-mods/core'
import type { GateState } from '../types'

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no baseline captured' }
const gate = atom({ plugin: 'behavior-lock', key: 'gate' } as const, IDLE, { shape: 'gate-1' })

type Baseline = { name: string; files: Record<string, ExportEntry[]> }

async function surfaceOf($: EngineInterface, files: readonly string[]): Promise<Record<string, ExportEntry[]>> {
  const out: Record<string, ExportEntry[]> = {}
  for (const path of files) {
    out[path] = extractSurface(await $.fs.read(path))
  }
  return out
}

function flatten(files: Record<string, ExportEntry[]>): ExportEntry[] {
  return Object.entries(files).flatMap(([file, entries]) =>
    entries.map(entry => ({ name: `${file}#${entry.name}`, signature: entry.signature })),
  )
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lock',
      description: 'Behavior lock: /lock capture <name> <files...> | /lock compare <name>',
    })
    return next(e)
  })

  on('command.run', { command: 'lock' }, async ($, e) => {
    const [subcommand = '', name = '', ...files] = e.args.trim().split(/\s+/).filter(word => word.length > 0)
    if (!/^[a-z0-9-]{1,40}$/.test(name)) {
      return { text: 'Usage: /lock capture|compare <name> [files...]. The name is lowercase letters, digits or dashes.' }
    }
    const path = stateRelativePath(`behavior/${name}.json`)

    if (subcommand === 'capture') {
      if (files.length === 0) return { text: 'Name the files to capture.' }
      const normalized = files.map(normalizePath)
      const baseline: Baseline = { name, files: await surfaceOf($, normalized) }
      await $.fs.write(path, `${JSON.stringify(baseline, null, 2)}\n`)
      const count = Object.values(baseline.files).reduce((sum, list) => sum + list.length, 0)
      await update($, gate, () => ({ verdict: 'PASS', phase: 'baseline', reason: `${count} export(s) captured as ${name}` }))
      return { text: `Baseline ${name}: ${count} export(s) across ${normalized.length} file(s).` }
    }

    if (subcommand === 'compare') {
      let baseline: Baseline
      try {
        baseline = JSON.parse(await $.fs.read(path)) as Baseline
      } catch {
        return { text: `No baseline named ${name}. Capture it first.` }
      }
      const current = await surfaceOf($, Object.keys(baseline.files))
      const diff = diffSurface(flatten(baseline.files), flatten(current))
      const breaking = diff.removed.length + diff.changed.length
      await update($, gate, () => ({
        verdict: breaking === 0 ? 'PASS' : 'FAIL',
        phase: 'compared',
        reason: truncate(`${diff.removed.length} removed, ${diff.changed.length} changed, ${diff.added.length} added`, 200),
      }))
      const lines = [
        breaking === 0 ? 'Surface matches the baseline (additions only).' : 'Breaking surface change.',
        ...diff.removed.map(item => `removed: ${item}`),
        ...diff.changed.map(item => `changed: ${item}`),
        ...diff.added.map(item => `added: ${item}`),
      ]
      return { text: lines.join('\n') }
    }

    return { text: 'Usage: /lock capture|compare <name> [files...]' }
  })
}
