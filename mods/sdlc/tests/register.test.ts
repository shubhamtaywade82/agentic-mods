import { expect, test } from 'claude-code/testing'

// Session-level test: commands are registered at session start and answered.

const run = (command: string, args = '') =>
  ({
    command,
    args,
    origin: { kind: 'plugin', name: 'sdlc' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

test('/sdlc-* commands are registered and answer with stage instructions', async ($, on) => {
  // session.start already ran; answer a command run in Claude Code's place.
  on('command.run', { command: 'sdlc-prd' }, () => ({ text: 'placeholder' }))

  const answer = await $.command.run(run('sdlc-prd', 'Add dark mode'))
  expect(answer.text).toContain('docs/prd/add-dark-mode.md')
  expect(answer.text).toContain('Given/When/Then')
})
