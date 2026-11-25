import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  appendCapped,
  diffLines,
  summarizeDiff,
  trimContext,
  registerCommand,
} from '@agentic-mods/core'
import type { ReplayChange, ReplayState } from '../types'

const PANE = 'turn-replay'
const MAX_CHANGES = 20
const MAX_LINES = 60
const MAX_LINE_LENGTH = 200

const IDLE: ReplayState = { turn: 0, changes: [] }
const replay = atom({ plugin: 'turn-replay', key: 'replay' } as const, IDLE, { shape: 'replay-1' })
const cursor = atom({ plugin: 'turn-replay', key: 'cursor' } as const, 0, { shape: 'cursor-1' })

async function snapshot($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function recordChange(
  $: EngineInterface,
  file: string,
  before: string | null,
  after: string | null,
): Promise<void> {
  if (before === after) return
  const full = diffLines(before ?? '', after ?? '')
  const { added, removed } = summarizeDiff(full)
  const lines = trimContext(full, 2)
    .slice(0, MAX_LINES)
    .map((op) => ({ kind: op.kind, line: op.line.slice(0, MAX_LINE_LENGTH) }))
  await update($, replay, (current) => {
    const nextId = (current.changes[current.changes.length - 1]?.id ?? 0) + 1
    const change: ReplayChange = { id: nextId, turn: current.turn, file, added, removed, lines }
    return { ...current, changes: appendCapped(current.changes, change, MAX_CHANGES) }
  })
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'replay',
      description: 'Step through the file changes of the session: /replay [number]',
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, replay, (current) => ({ ...current, turn: current.turn + 1 }))
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const before = await snapshot($, e.file_path)
    const ran = await next(e)
    if (ran.deny === undefined) {
      await recordChange($, e.file_path, before, await snapshot($, e.file_path))
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const before = await snapshot($, e.file_path)
    const ran = await next(e)
    if (ran.deny === undefined) {
      await recordChange($, e.file_path, before, await snapshot($, e.file_path))
    }
    return ran
  })

  on('command.run', { command: 'replay' }, async ($, e) => {
    const state = await read($, replay)
    const requested = Number.parseInt(e.args.trim(), 10)
    const last = Math.max(0, state.changes.length - 1)
    const index =
      Number.isFinite(requested) && requested >= 1 ? Math.min(requested - 1, last) : last
    await update($, cursor, () => index)
    await $.ui.open({ id: PANE, title: 'Turn replay' })
    return {
      text: state.changes.length === 0 ? 'No edits recorded yet.' : `Showing change ${index + 1}.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const state = await read($, replay)
    if (state.changes.length === 0) {
      return (
        <Box>
          <Text dimColor>No file changes recorded in this session yet.</Text>
        </Box>
      )
    }
    const index = Math.min(await read($, cursor), state.changes.length - 1)
    const change = state.changes[index]
    if (change === undefined) return <Box />
    const last = state.changes.length - 1
    return (
      <Box flexDirection="column">
        <Text>
          {`Change ${index + 1} of ${state.changes.length} · turn ${change.turn} · ${change.file} · +${change.added} −${change.removed}`}
        </Text>
        {change.lines.map((row, position) => (
          <Text key={`row-${position}`} dimColor={row.kind === 'equal'}>
            {row.kind === 'insert' ? '+ ' : row.kind === 'delete' ? '- ' : '  '}
            {row.line}
          </Text>
        ))}
        <Box>
          <Button
            key="previous"
            label="Previous"
            onPress={() => update($, cursor, (current) => Math.max(0, current - 1))}
          />
          <Button
            key="next"
            label="Next"
            onPress={() => update($, cursor, (current) => Math.min(last, current + 1))}
          />
        </Box>
      </Box>
    )
  })
}
