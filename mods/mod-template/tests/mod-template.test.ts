import { expect, test } from 'claude-code/testing'

// Tests run with no session, sign-in or network. Stub anything real
// Claude Code would normally answer.

// Older Claude Code builds type $.command.run's input with `origin` and
// `presentation`; newer ones fill them in. Building the input as a variable
// (not a fresh object literal) type-checks on both.
const tallyInput = {
  command: 'mod-template-tally',
  args: '',
  origin: { kind: 'plugin', name: 'mod-template' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('/mod-template-tally counts the tool-call attempts the mod has seen', async ($, on) => {
  // Answer each tool call in Claude Code's place so no tool runs.
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: 'README.md' })

  const answer = await $.command.run(tallyInput)
  expect(answer.text).toBe('Claude has made 2 tool-call attempts since this mod loaded')
})

test('/mod-template-tally counts denied calls as attempts', async ($, on) => {
  // A later hook denies the call; the counter increments before next(e),
  // so the attempt is still counted.
  on('tool.call', () => ({ deny: 'blocked by test guard' }))

  await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/x' }).catch(() => undefined)

  const answer = await $.command.run(tallyInput)
  expect(answer.text).toBe('Claude has made 1 tool-call attempts since this mod loaded')
})
