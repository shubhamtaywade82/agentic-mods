import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  ADAPTERS,
  buildTypeScriptGraph,
  dependentsOf,
  type GitRunner,
  parseNameList,
  workingTreeChanges,
  registerCommand,
} from '@agentic-mods/core'
import type { ImpactStatus } from '../types'

const PANE = 'test-impact'
const MAX_FILES = 3000
const MAX_BYTES = 300_000
const JS_SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const SHARED_CONFIG =
  /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig[^/]*\.json|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|babel\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|turbo\.json)$/

const IDLE: ImpactStatus = { selection: [], untested: [], full: false, reason: 'not computed yet' }
const impact = atom({ plugin: 'test-impact', key: 'impact' } as const, IDLE, { shape: 'impact-1' })

function runnerOf($: EngineInterface): GitRunner {
  return async (argv) => {
    const result = await $.process.run(argv)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

function fullSuite(reason: string): ImpactStatus {
  return { selection: [], untested: [], full: true, reason }
}

/** Reads the sources that fit the size cap; returns how many were left out. */
async function readSources($: EngineInterface, paths: readonly string[]) {
  const sources = new Map<string, string>()
  let skipped = Math.max(0, paths.length - MAX_FILES)
  for (const path of paths.slice(0, MAX_FILES)) {
    try {
      if ((await $.fs.stat(path)).size <= MAX_BYTES) sources.set(path, await $.fs.read(path))
      else skipped += 1
    } catch {
      skipped += 1
    }
  }
  return { sources, skipped }
}

async function computeImpact($: EngineInterface): Promise<ImpactStatus> {
  const run = runnerOf($)
  const tracked = await run(['git', 'ls-files', '-z'])
  if (tracked.exitCode !== 0) return fullSuite('not a git repository; run the full suite')
  const changed = await workingTreeChanges(run)
  if (changed === null) return fullSuite('git status failed, so the impact is unknown')
  const changedPaths = changed.map((entry) => entry.path)
  if (changedPaths.some((path) => SHARED_CONFIG.test(path))) {
    return fullSuite('shared configuration changed: run the full suite')
  }
  // Untracked files are not in ls-files but are part of the change.
  const candidates = new Set([...parseNameList(tracked.stdout), ...changedPaths])
  const { sources, skipped } = await readSources(
    $,
    [...candidates].filter((path) => JS_SOURCE.test(path)),
  )
  const graph = buildTypeScriptGraph(sources)
  const isTest = ADAPTERS.javascript.isTestFile
  const changedSource = changedPaths.filter((path) => sources.has(path))
  const reached = new Set([...dependentsOf(graph, changedSource), ...changedSource])
  const selection = [...reached].filter((path) => isTest(path)).sort()
  const untested = changedSource
    .filter((path) => !isTest(path))
    .filter((path) => ![...dependentsOf(graph, [path])].some((file) => isTest(file)))
    .sort()
  const traced =
    changedSource.length === 0
      ? 'no JavaScript or TypeScript source changed'
      : `${changedSource.length} changed source file(s) traced through the import graph`
  const reason =
    skipped > 0 ? `${traced}; ${skipped} file(s) too large or unreadable were left out` : traced
  return { selection, untested, full: false, reason }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'impact',
      description: 'Select the tests that the current changes reach',
    })
    return next(e)
  })

  on('command.run', { command: 'impact' }, async ($) => {
    const result = await computeImpact($)
    await update($, impact, () => result)
    await $.ui.open({ id: PANE, title: 'Test impact' })
    if (result.full) return { text: `Run the full suite: ${result.reason}` }
    const lines = [
      `${result.reason}`,
      `tests to run (${result.selection.length}): ${result.selection.join(', ') || 'none reach the change'}`,
      `changed code with no test reaching it: ${result.untested.join(', ') || 'none'}`,
    ]
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, impact)
    return (
      <Box flexDirection="column">
        <Text>{current.full ? 'Full suite required' : 'Targeted selection'}</Text>
        <Text dimColor>{current.reason}</Text>
        {current.selection.map((path) => (
          <Text key={`test-${path}`}>test {path}</Text>
        ))}
        {current.untested.map((path) => (
          <Text key={`gap-${path}`}>gap {path}</Text>
        ))}
      </Box>
    )
  })
}
