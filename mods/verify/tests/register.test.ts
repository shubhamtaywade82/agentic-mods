// Session-level tests for the verify mod: /verify-run returns an outcome and
// /verify-status reflects the session.

import { expect, test } from 'claude-code/testing'

const runInput = (args: string) => ({
  command: 'verify-run',
  args,
  origin: { kind: 'plugin', name: 'verify' },
  presentation: { isFullscreen: false, columns: 80 },
}) as const

const statusInput = {
  command: 'verify-status',
  args: '',
  origin: { kind: 'plugin', name: 'verify' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('/verify-run with no args prints usage', async ($) => {
  const answer = await $.command.run(runInput(''))
  expect(answer.text).toContain('usage:')
})

test('/verify-run returns an outcome with a status line', async ($, on) => {
  // Stub the host tool call so execute() resolves to a string.
  on('tool.call', () => ({ result: 'fix the typo in the README' }))

  const answer = await $.command.run(runInput('fix the typo in the README'))
  expect(answer.text).toContain('verify run:')
  expect(answer.text).toContain('status:')
})

test('/verify-status reports the session runs', async ($, on) => {
  on('tool.call', () => ({ result: 'fix the typo in the README' }))
  await $.command.run(runInput('fix the typo in the README'))

  const answer = await $.command.run(statusInput)
  expect(answer.text).toContain('verify session status')
  expect(answer.text).toContain('runs: 1')
})
