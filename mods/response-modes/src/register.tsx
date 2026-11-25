import type { EngineInterface, On } from 'claude-code'
import { registerCommand } from '@agentic-mods/core'

type Style = 'tldr' | 'simple'

const STYLE_TEXT: Readonly<Record<Style, string>> = {
  tldr: 'Answer in at most five sentences. Lead with the decision or the result, then the one detail the reader needs.',
  simple:
    'Write in plain language: short sentences, no unexplained jargon. Define a technical term in a few words the first time you use it.',
}

const COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ['tldr', 'Concise responses: five sentences at most'],
  ['mode-simple', 'Plain-language responses'],
  ['mode-off', 'Return to the default response style'],
]

const CONFIRMATION: Readonly<Record<Style | 'off', string>> = {
  tldr: 'Concise response style on.',
  simple: 'Plain-language response style on.',
  off: 'Default response style restored.',
}

async function setStyle($: EngineInterface, style: Style | null): Promise<{ text: string }> {
  if (style === null) await $.store.delete('style')
  else await $.store.set('style', style)
  return { text: CONFIRMATION[style ?? 'off'] }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await registerCommand($, { name, description })
    }
    // $.store outlives the session; the style is meant to last one session, and a hot reload
    // re-runs session.start, so clear it only when the session id changes.
    const sessionId = await $.session.id()
    if ((await $.store.get('sessionId')) !== sessionId) {
      await $.store.set('sessionId', sessionId)
      await $.store.delete('style')
    }
    return next(e)
  })

  // Literal names, so the repository's static command check can see every handler.
  on('command.run', { command: 'tldr' }, ($) => setStyle($, 'tldr'))
  on('command.run', { command: 'mode-simple' }, ($) => setStyle($, 'simple'))
  on('command.run', { command: 'mode-off' }, ($) => setStyle($, null))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const style = await $.store.get('style')
    if (style !== 'tldr' && style !== 'simple') return composed
    return {
      sections: [
        ...composed.sections,
        { id: 'response-modes:style', text: STYLE_TEXT[style], scope: 'session' as const },
      ],
    }
  })
}
