import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  diffDependencies,
  isManifestFile,
  normalizePath,
  parseManifest,
  stateRelativePath,
  truncate,
  registerCommand,
} from '@agentic-mods/core'
import type { RadarStatus } from '../types'

const IDLE: RadarStatus = { verdict: 'UNKNOWN', changes: [], scan: 'no scan recorded' }
const status = atom({ plugin: 'dependency-radar', key: 'status' } as const, IDLE, {
  shape: 'status-1',
})

async function readOrNull($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

function parseOrNull(path: string, text: string | null): ReturnType<typeof parseManifest> | null {
  if (text === null) return []
  try {
    return parseManifest(path, text)
  } catch {
    return null
  }
}

async function analyse(
  $: EngineInterface,
  path: string,
  before: string | null,
  after: string | null,
): Promise<void> {
  const previous = parseOrNull(path, before)
  const current = parseOrNull(path, after)
  if (previous === null || current === null) {
    await update($, status, (state) => ({
      ...state,
      verdict: 'UNKNOWN' as const,
      changes: [`${path}: could not be parsed; review it by hand`],
    }))
    return
  }
  const diff = diffDependencies(previous, current)
  const changes = [
    ...diff.added.map((dep) => `+ ${dep.name} ${dep.version}${dep.isDev ? ' (dev)' : ''}`),
    ...diff.removed.map((dep) => `- ${dep.name} ${dep.version}`),
    ...diff.changed.map(
      (item) => `${item.isMajor ? 'MAJOR ' : ''}~ ${item.name} ${item.from} -> ${item.to}`,
    ),
  ].map((line) => truncate(`${path}: ${line}`, 200))
  const verdict: RadarStatus['verdict'] = changes.length === 0 ? 'PASS' : 'UNKNOWN'
  await update($, status, (state) => ({ ...state, verdict, changes: changes.slice(0, 50) }))
  for (const item of diff.changed) {
    if (item.isMajor)
      $.ui.toast(`dependency-radar: major change to ${item.name}; review before release`)
  }
}

type ScanEntry = { name: string; severity: string }

async function readScan($: EngineInterface): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await $.fs.read(stateRelativePath('scans/latest.json')))
  } catch {
    return 'no scan recorded (.agentic-mods/scans/latest.json)'
  }
  if (!Array.isArray(parsed)) return 'scan file is not a list; ignored'
  const entries = parsed.filter(
    (item): item is ScanEntry =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ScanEntry).name === 'string' &&
      typeof (item as ScanEntry).severity === 'string',
  )
  const serious = entries.filter((item) => item.severity === 'high' || item.severity === 'critical')
  const verdict: RadarStatus['verdict'] = serious.length > 0 ? 'FAIL' : 'PASS'
  const summary = `${entries.length} finding(s), ${serious.length} high or critical`
  await update($, status, (state) => ({ ...state, verdict, scan: summary }))
  return summary
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'radar',
      description: 'Read the recorded dependency scan: /radar scan',
    })
    return next(e)
  })

  on('command.run', { command: 'radar' }, async ($) => ({ text: `scan: ${await readScan($)}` }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const path = normalizePath(e.file_path)
    if (!isManifestFile(path)) return next(e)
    const before = await readOrNull($, path)
    const ran = await next(e)
    if (ran.deny === undefined) await analyse($, path, before, await readOrNull($, path))
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const path = normalizePath(e.file_path)
    if (!isManifestFile(path)) return next(e)
    const before = await readOrNull($, path)
    const ran = await next(e)
    if (ran.deny === undefined) await analyse($, path, before, await readOrNull($, path))
    return ran
  })
}
