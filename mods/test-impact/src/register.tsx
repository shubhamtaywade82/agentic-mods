import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  ADAPTERS,
  buildTypeScriptGraph,
  dependentsOf,
  type GitRunner,
  parseNameList,
  workingTreeChanges,
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
  return async argv => {
    const result = await $.process.run(argv)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

async function computeImpact($: EngineInterface): Promise<ImpactStatus> {
  const run = runnerOf($)
  const tracked = await run(['git', 'ls-files', '-z'])
  if (tracked.exitCode !== 0) {
    return { selection: [], untested: [], full: true, reason: 'not a git repository; run the full suite' }
  }
  const files = parseNameList(tracked.stdout).filter(path => JS_SOURCE.test(path)).slice(0, MAX_FILES)
  const sources = new Map<string, string>()
  for (const path of files) {
    try {
      const size = (await $.fs.stat(path)).size
      if (size <= MAX_BYTES) sources.set(path, await $.fs.read(path))
    } catch {
      // unreadable files are left out of the graph and reported nowhere else
    }
  }
  const graph = buildTypeScriptGraph(sources)
  const isTest = ADAPTERS.javascript.isTestFile

  const changed = (await workingTreeChanges(run)) ?? []
  const changedPaths = changed.map(entry => entry.path)
  if (changedPaths.some(path => SHARED_CONFIG.test(path))) {
    return {
      selection: [],
      untested: [],
      full: true,
      reason: 'shared configuration changed: run the full suite',
    }
  }
  const changedSource = changedPaths.filter(path => JS_SOURCE.test(path) && sources.has(path))
  const reached = dependentsOf(graph, changedSource)
  const selection = [...reached].filter(path => isTest(path)).sort()
  const untested = changedSource
    .filter(path => !isTest(path))
    .filter(path => ![...dependentsOf(graph, [path])].some(file => isTest(file)))
    .sort()
  return {
    selection,
    untested,
    full: false,
    reason:
      changedSource.length === 0
        ? 'no JavaScript or TypeScript source changed'
        : `${changedSource.length} changed source file(s) traced through the import graph`,
  }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'impact', description: 'Select the tests that the current changes reach' })
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
        {current.selection.map(path => (
          <Text key={`test-${path}`}>test  {path}</Text>
        ))}
        {current.untested.map(path => (
          <Text key={`gap-${path}`}>gap   {path}</Text>
        ))}
      </Box>
    )
  })
}
