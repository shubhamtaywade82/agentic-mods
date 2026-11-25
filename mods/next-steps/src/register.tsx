import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Steps } from '../types'

const IDLE: Steps = { texts: [] }
const steps = atom({ plugin: 'next-steps', key: 'steps' } as const, IDLE, { shape: 'steps-1' })

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'next-steps', description: 'Show suggested next prompts' })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await $.store.set('edits', 0)
    await update($, steps, () => IDLE)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // Count only edits that ran: a denied or failed one changed no file.
    const changedFile = (e.tool === 'Edit' || e.tool === 'Write') && !ran.deny && !ran.isError
    if (changedFile) await $.store.set('edits', Number((await $.store.get('edits')) ?? 0) + 1)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.reason !== 'answer') return next(e)
    const edits = Number((await $.store.get('edits')) ?? 0)
    const texts =
      edits > 0
        ? [
            'Run /evidence run to refresh the required checks.',
            'Run /impact to see which tests this change reaches.',
            'Summarise what changed and what is still unverified.',
          ]
        : ['Summarise the open risks in this session.']
    await update($, steps, () => ({ texts }))
    return next(e)
  })

  on('command.run', { command: 'next-steps' }, async ($) => {
    const current = await read($, steps)
    if (current.texts.length === 0)
      return { text: 'No suggestions yet: they appear after a turn that changes files.' }
    return { text: current.texts.map((text, index) => `${index + 1}. ${text}`).join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, steps)
    if (current.texts.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>Next: </Text>
        {current.texts.map((text, index) => (
          <Button
            key={`step-${index}`}
            label={text.length > 48 ? `${text.slice(0, 47)}…` : text}
            onPress={() => $.prompt.suggest({ text })}
          />
        ))}
      </Box>
    )
  })
}
