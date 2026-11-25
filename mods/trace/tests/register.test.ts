// Session-level tests for the trace mod: events feed the store and /trace
// reflects what happened.

import { expect, test } from 'claude-code/testing'

const traceInput = {
  command: 'trace',
  args: '',
  origin: { kind: 'plugin', name: 'trace' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const summaryInput = {
  command: 'trace-summary',
  args: '',
  origin: { kind: 'plugin', name: 'trace' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('/trace shows the main agent after session start', async ($) => {
  const answer = await $.command.run(traceInput)
  expect(answer.text).toContain('main')
})

test('/trace-summary reports node counts', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: 'README.md' })

  const answer = await $.command.run(summaryInput)
  expect(answer.text).toContain('trace summary')
  expect(answer.text).toContain('tools')
})

test('a denied tool call is recorded as failed', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'blocked' }))

  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }).catch(() => undefined)
  const answer = await $.command.run(summaryInput)
  expect(answer.text).toContain('failed')
})
