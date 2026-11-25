import type { On } from 'claude-code'
import { renderAnswer } from './lib/index'
import { registerCommand } from '@agentic-mods/core'

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'patterns',
      description:
        'Look up a GoF pattern, list a category, or describe a problem to get candidates',
    })
    return next(e)
  })

  on('command.run', { command: 'patterns' }, async (_$, e) => {
    return { text: renderAnswer(typeof e.args === 'string' ? e.args : '') }
  })
}
