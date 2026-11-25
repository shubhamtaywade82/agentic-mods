// design-patterns: reference mod exposing the two GoF pattern skills.
//
// register.ts is a thin adapter over lib/index.ts (pure, unit-tested):
//   - /patterns [query|list <category>]  -> pattern card, listing, or
//     problem-based candidate suggestions.

import type { Register } from 'claude-code'
import { renderAnswer } from './lib/index'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'patterns',
      description: 'Look up a GoF pattern, list a category, or describe a problem to get candidates',
    })
    return next(e)
  })

  on('command.run', { command: 'patterns' }, async (_$, e) => {
    void _$
    return { text: renderAnswer(typeof e.args === 'string' ? e.args : '') }
  })
}
