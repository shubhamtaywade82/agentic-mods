// sdlc: the AI Dev Kit's 8-stage feature lifecycle as a Claude Code mod.
//
// The register.ts below is a thin adapter: it registers the command names and
// answers each /sdlc-* run by returning the prompt text built in lib/commands.ts
// (pure, unit-tested). The heavy reference material (workflows, templates,
// checklists, agent roles) lives in this mod's skills/ directory, which Claude
// reads like any other skill content when working through a stage.

import type { Register } from 'claude-code'
import { COMMANDS, buildCommandPrompt } from './lib/commands'

export const register: Register = (on) => {
  // Register every lifecycle command once per session.
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) {
      await $.command.register({ name: c.name, description: c.description })
    }
    return next(e)
  })

  // ANSWER each /sdlc-* command with its stage instructions. A dedicated
  // handler with an exact matcher per command means non-sdlc commands (the
  // built-in /help, /clear, ...) fall through untouched instead of being
  // swallowed by a catch-all that returns nothing.
  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async (_$, e) => {
      void _$
      const args = typeof e.args === 'string' ? e.args : ''
      return { text: buildCommandPrompt(c.name, args) }
    })
  }
}
