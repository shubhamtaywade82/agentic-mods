import type { On } from 'claude-code'

type Style = 'tldr' | 'simple'

const STYLE_TEXT: Readonly<Record<Style, string>> = {
  tldr: 'Answer in at most five sentences. Lead with the decision or the result, then the one detail the reader needs.',
  simple:
    'Write in plain language: short sentences, no unexplained jargon. Define a technical term in a few words the first time you use it.',
}

const COMMANDS: ReadonlyArray<readonly [string, Style | null, string]> = [
  ['tldr', 'tldr', 'Concise responses: five sentences at most'],
  ['mode-simple', 'simple', 'Plain-language responses'],
  ['mode-off', null, 'Return to the default response style'],
]

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    for (const [name, , description] of COMMANDS) {
      await $.command.register({ name, description })
    }
    return next(e)
  })

  on('command.run', { command: 'tldr' }, async ($) => {
    await $.store.set('style', 'tldr')
    return { text: 'Concise response style on.' }
  })

  on('command.run', { command: 'mode-simple' }, async ($) => {
    await $.store.set('style', 'simple')
    return { text: 'Plain-language response style on.' }
  })

  on('command.run', { command: 'mode-off' }, async ($) => {
    await $.store.delete('style')
    return { text: 'Default response style restored.' }
  })

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
