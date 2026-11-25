import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { truncate, registerCommand } from '@agentic-mods/core'
import type { Orientation } from '../types'

const PANE = 'task-orientation'
const IDLE: Orientation = { goal: null, task: null, blocker: null, next: null }
const orientation = atom({ plugin: 'task-orientation', key: 'orientation' } as const, IDLE, {
  shape: 'orientation-1',
})

type Field = 'goal' | 'task' | 'blocker' | 'next'
const COMMANDS: Readonly<Record<string, Field>> = {
  goal: 'goal',
  task: 'task',
  blocker: 'blocker',
  next: 'next',
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    for (const name of [
      'orient-goal',
      'orient-task',
      'orient-blocker',
      'orient-next',
      'orient-show',
    ]) {
      await registerCommand($, {
        name,
        description: `task-orientation: ${name === 'orient-show' ? 'show the pane' : `set the ${name.replace('orient-', '')}`}`,
      })
    }
    return next(e)
  })

  // The first prompt of a session becomes the goal unless one was already set.
  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined) {
      const state = await read($, orientation)
      if (state.goal === null && e.text.trim().length > 0) {
        await update($, orientation, (current) => ({
          ...current,
          goal: truncate(e.text.trim(), 300),
        }))
      }
    }
    return next(e)
  })

  on('command.run', { command: 'orient-goal' }, async ($, e) => {
    await update($, orientation, (current) => ({
      ...current,
      goal: truncate(e.args.trim(), 300) || null,
    }))
    return { text: 'Goal updated.' }
  })

  on('command.run', { command: 'orient-task' }, async ($, e) => {
    await update($, orientation, (current) => ({
      ...current,
      task: truncate(e.args.trim(), 300) || null,
    }))
    return { text: 'Current task updated.' }
  })

  on('command.run', { command: 'orient-blocker' }, async ($, e) => {
    const text = e.args.trim()
    await update($, orientation, (current) => ({
      ...current,
      blocker: text === 'clear' || text === '' ? null : truncate(text, 300),
    }))
    return { text: 'Blocker updated.' }
  })

  on('command.run', { command: 'orient-next' }, async ($, e) => {
    await update($, orientation, (current) => ({
      ...current,
      next: truncate(e.args.trim(), 300) || null,
    }))
    return { text: 'Next step updated.' }
  })

  on('command.run', { command: 'orient-show' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Where am I' })
    return { text: 'Task orientation pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const state = await read($, orientation)
    const rows: Array<[string, string | null]> = [
      ['Goal', state.goal],
      ['Current task', state.task],
      ['Blocker', state.blocker],
      ['Next step', state.next],
    ]
    return (
      <Box flexDirection="column">
        {rows.map(([label, value]) => (
          <Text key={label}>
            {label}: {value ?? 'not set'}
          </Text>
        ))}
      </Box>
    )
  })

  void COMMANDS
}
