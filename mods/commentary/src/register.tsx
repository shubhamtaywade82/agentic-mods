import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { analyzeCommand } from '@agentic-mods/core'

import type { Voice } from '../types'

const LINES: Readonly<Record<Exclude<Voice, 'off'>, Readonly<Record<'edit' | 'command' | 'git' | 'tool', readonly string[]>>>> = {
  sport: {
    edit: ['And a change to the file, right on target!', 'The editor goes to work on the file!'],
    command: ['The command is sent down the field!', 'A shell command in the play!'],
    git: ['Into the repository, the team is pushing forward!', 'A git step, and the crowd is on its feet!'],
    tool: ['Another tool call, quick and clean!', 'A tool call from the bench!'],
  },
  monologue: {
    edit: ['It changed the file. Was that the right file?', 'An edit. Each one is a small commitment.'],
    command: ['It ran a command. What did it expect to learn?', 'A command, run without a hypothesis.'],
    git: ['It touches the history now. Is the evidence current?', 'A git step. Check the gate first.'],
    tool: ['A tool call. One more step in the same direction.', 'Another call. Is the loop converging?'],
  },
}

const voice = atom({ plugin: 'commentary', key: 'voice' } as const, 'off' as Voice, { shape: 'voice-1' })
const latest = atom({ plugin: 'commentary', key: 'latest' } as const, '', { shape: 'latest-1' })

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'commentary', description: 'Commentary voice: /commentary sport|monologue|off' })
    return next(e)
  })

  on('command.run', { command: 'commentary' }, async ($, e) => {
    const chosen = e.args.trim()
    if (chosen !== 'sport' && chosen !== 'monologue' && chosen !== 'off') {
      return { text: 'Usage: /commentary sport|monologue|off' }
    }
    await update($, voice, () => chosen)
    await update($, latest, () => '')
    return { text: `Commentary: ${chosen}.` }
  })

  on('tool.call', async ($, e, next) => {
    const current = await read($, voice)
    if (current === 'off') return next(e)
    const kind =
      e.tool === 'Edit' || e.tool === 'Write'
        ? 'edit'
        : e.tool === 'Bash' && analyzeCommand(e.command).gitActions.length > 0
          ? 'git'
          : e.tool === 'Bash'
            ? 'command'
            : 'tool'
    const lines = LINES[current][kind]
    const count = Number((await $.store.get('lines')) ?? 0)
    await $.store.set('lines', count + 1)
    await update($, latest, () => lines[count % lines.length] ?? '')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, latest)
    if (text === '') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{text}</Text>
      </Box>
    )
  })
}
