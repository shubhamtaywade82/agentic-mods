import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { appendCapped, redact, truncate } from '@agentic-mods/core'
import type { TimelineEntry, TimelineState } from '../types'

const PANE = 'debug-timeline'
const MAX_ENTRIES = 200
const REPEAT_WINDOW = 20
const REPEAT_THRESHOLD = 3

const IDLE: TimelineState = { entries: [], repeated: [] }
const timeline = atom({ plugin: 'debug-timeline', key: 'timeline' } as const, IDLE, {
  shape: 'timeline-1',
})

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hypothesis',
      description: 'Record a debugging hypothesis: /hypothesis <text>',
    })
    await $.command.register({
      name: 'result',
      description: 'Record a hypothesis outcome: /result <id> confirmed|rejected <evidence>',
    })
    await $.command.register({
      name: 'timeline',
      description: 'Show the debugging timeline in a pane',
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = truncate(redact(e.command), 300)
    const at = await $.clock.now()
    await update($, timeline, (current) => {
      const entry: TimelineEntry = {
        id: `C${current.entries.length + 1}`,
        at,
        kind: 'command',
        text: command,
        outcome: null,
      }
      const entries = appendCapped(current.entries, entry, MAX_ENTRIES)
      const recent = entries.slice(-REPEAT_WINDOW).filter((item) => item.kind === 'command')
      const counts = new Map<string, number>()
      for (const item of recent) counts.set(item.text, (counts.get(item.text) ?? 0) + 1)
      const repeated = [...counts]
        .filter(([, count]) => count >= REPEAT_THRESHOLD)
        .map(([text]) => text)
      return { entries, repeated }
    })
    const current = await read($, timeline)
    if (current.repeated.includes(command)) {
      $.ui.toast(
        'debug-timeline: this command has run several times; state a hypothesis before running it again',
      )
    }
    return next(e)
  })

  on('command.run', { command: 'hypothesis' }, async ($, e) => {
    const text = truncate(redact(e.args.trim()), 500)
    if (text === '') return { text: 'Usage: /hypothesis <text>' }
    const at = await $.clock.now()
    await update($, timeline, (current) => ({
      ...current,
      entries: appendCapped(
        current.entries,
        { id: `H${current.entries.length + 1}`, at, kind: 'hypothesis', text, outcome: 'open' },
        MAX_ENTRIES,
      ),
    }))
    return { text: 'Hypothesis recorded as open.' }
  })

  on('command.run', { command: 'result' }, async ($, e) => {
    const [id = '', outcome = '', ...rest] = e.args.trim().split(/\s+/)
    if (
      !/^H\d+$/.test(id) ||
      (outcome !== 'confirmed' && outcome !== 'rejected') ||
      rest.length === 0
    ) {
      return { text: 'Usage: /result <H-id> confirmed|rejected <evidence>' }
    }
    const evidence = truncate(redact(rest.join(' ')), 500)
    const resolved: 'confirmed' | 'rejected' = outcome === 'confirmed' ? 'confirmed' : 'rejected'
    const at = await $.clock.now()
    await update($, timeline, (current) => ({
      ...current,
      entries: appendCapped(
        current.entries.map((item) => (item.id === id ? { ...item, outcome: resolved } : item)),
        {
          id: `R${current.entries.length + 1}`,
          at,
          kind: 'result',
          text: `${id} ${resolved}: ${evidence}`,
          outcome: resolved,
        },
        MAX_ENTRIES,
      ),
    }))
    return { text: `${id} ${resolved}.` }
  })

  on('command.run', { command: 'timeline' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Debug timeline' })
    return { text: 'Debug timeline pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, timeline)
    if (current.entries.length === 0) {
      return (
        <Box>
          <Text dimColor>Nothing recorded yet. Commands are recorded as they run.</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {current.entries.slice(-40).map((entry) => (
          <Text key={entry.id} dimColor={entry.kind === 'command'}>
            {entry.id} {entry.kind}
            {entry.outcome === null ? '' : ` [${entry.outcome}]`}: {entry.text}
          </Text>
        ))}
        {current.repeated.length > 0 ? (
          <Text>Repeated commands: {current.repeated.length}</Text>
        ) : null}
      </Box>
    )
  })
}
