import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  allowed,
  architectureDecision,
  type Decision,
  describeDecision,
  extractImports,
  findLayerViolations,
  type ImportLanguage,
  loadConfig,
  newViolations,
  parseNameList,
  resolveJavaImport,
  resolveTypeScriptImport,
  stateRelativePath,
} from '@agentic-mods/core'
import type { ArchitectureStatus } from '../types'

const PANE = 'architecture-guard'
const MAX_SCAN_FILES = 2000
const MAX_BYTES = 300_000
const TS_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const JAVA_FILE = /\.java$/

const IDLE: ArchitectureStatus = {
  verdict: 'UNKNOWN',
  reason: 'not scanned yet',
  fresh: 0,
  baseline: 0,
}
const status = atom({ plugin: 'architecture-guard', key: 'status' } as const, IDLE, {
  shape: 'status-1',
})

function languageOf(path: string): ImportLanguage | null {
  if (TS_FILE.test(path)) return 'typescript'
  if (JAVA_FILE.test(path)) return 'java'
  return null
}

async function knownFiles($: EngineInterface): Promise<Set<string>> {
  const cached = await $.store.get('known')
  if (Array.isArray(cached)) return new Set(cached as string[])
  const result = await $.process.run(['git', 'ls-files', '-z'])
  const files = result.exitCode === 0 ? parseNameList(result.stdout) : []
  await $.store.set('known', files)
  return new Set(files)
}

async function baselineOf($: EngineInterface, file: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath(file))) as { violations?: unknown }
    const list = Array.isArray(parsed.violations) ? parsed.violations : []
    return new Set(list.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

/** Repository files that the imports of `path` resolve to. */
function targetsOf(path: string, content: string, known: ReadonlySet<string>): string[] {
  const language = languageOf(path)
  if (language === null) return []
  const specifiers = extractImports(language, content)
  const targets: string[] = []
  for (const specifier of specifiers) {
    const target =
      language === 'typescript'
        ? resolveTypeScriptImport(path, specifier, known)
        : resolveJavaImport(specifier, known)
    if (target !== null && target !== path) targets.push(target)
  }
  return targets
}

async function judge($: EngineInterface, path: string, content: string): Promise<Decision> {
  const config = (await loadConfig((p) => $.fs.read(p))).value.architecture
  if (config.layers.length === 0 || languageOf(path) === null) return allowed('architecture-guard')
  const known = await knownFiles($)
  const found = findLayerViolations(config.layers, path, targetsOf(path, content, known))
  const fresh = newViolations(found, await baselineOf($, config.baselineFile))
  const decision = architectureDecision(config.mode, fresh)
  const verdict: ArchitectureStatus['verdict'] =
    fresh.length === 0 ? 'PASS' : config.mode === 'enforce' ? 'FAIL' : 'UNKNOWN'
  await update($, status, (current) => ({
    ...current,
    verdict,
    reason:
      fresh.length === 0 ? 'no new layer violations' : `${fresh.length} new layer violation(s)`,
    fresh: fresh.length,
  }))
  return decision
}

async function scan($: EngineInterface): Promise<string> {
  const config = (await loadConfig((p) => $.fs.read(p))).value.architecture
  if (config.layers.length === 0) return 'No layers configured in .agentic-mods/config.json.'
  await $.store.delete('known')
  const known = await knownFiles($)
  const sources = [...known].filter((path) => languageOf(path) !== null).slice(0, MAX_SCAN_FILES)
  const all: string[] = []
  for (const path of sources) {
    try {
      if ((await $.fs.stat(path)).size > MAX_BYTES) continue
      const content = await $.fs.read(path)
      const found = findLayerViolations(config.layers, path, targetsOf(path, content, known))
      for (const item of found) all.push(item.key)
    } catch {
      // unreadable file: skipped, and counted nowhere, so the baseline stays conservative
    }
  }
  await $.fs.write(
    stateRelativePath(config.baselineFile),
    `${JSON.stringify({ violations: [...new Set(all)].sort() }, null, 2)}\n`,
  )
  await update($, status, (current) => ({
    ...current,
    verdict: 'PASS' as const,
    reason: 'baseline recorded; only new violations are reported',
    baseline: new Set(all).size,
  }))
  return `Scanned ${sources.length} file(s); baseline records ${new Set(all).size} existing violation(s).`
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'architecture',
      description:
        'Architecture layer checks: /architecture scan (records the baseline) or /architecture status',
    })
    return next(e)
  })

  on('command.run', { command: 'architecture' }, async ($, e) => {
    const subcommand = e.args.trim()
    if (subcommand === 'scan') return { text: await scan($) }
    const current = await read($, status)
    return {
      text: `architecture: ${current.verdict} · ${current.reason} · baseline ${current.baseline}`,
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (languageOf(e.file_path) === null) return next(e)
    const decision = await judge($, e.file_path, e.new_string)
    if (decision.decision === 'block') return { deny: describeDecision(decision) }
    if (decision.decision === 'warn') $.ui.toast(describeDecision(decision))
    return next(e)
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'architecture-guard failed closed on Edit.' },
  )

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (languageOf(e.file_path) === null) return next(e)
    const decision = await judge($, e.file_path, e.content)
    if (decision.decision === 'block') return { deny: describeDecision(decision) }
    if (decision.decision === 'warn') $.ui.toast(describeDecision(decision))
    return next(e)
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'architecture-guard failed closed on Write.' },
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, status)
    return (
      <Box flexDirection="column">
        <Text>Architecture: {current.verdict}</Text>
        <Text dimColor>
          {current.reason} · baseline {current.baseline}
        </Text>
      </Box>
    )
  })
}
