import type { On } from 'claude-code'
import { COMMANDS, buildCommandPrompt } from './lib/commands'
import { registerCommand } from '@agentic-mods/core'

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) {
      await registerCommand($, { name: c.name, description: c.description })
    }
    return next(e)
  })

  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async (_$, e) => {
      const args = typeof e.args === 'string' ? e.args : ''
      return { text: buildCommandPrompt(c.name, args) }
    })
  }
}
