import { expect, test } from 'claude-code/testing'

// Session-level tests: commands exist and answers use real usage data.

const usageInput = {
  command: 'pulse-usage',
  args: '',
  origin: { kind: 'plugin', name: 'pulse' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const reportInput = {
  command: 'pulse-report',
  args: '',
  origin: { kind: 'plugin', name: 'pulse' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('/pulse-usage renders the context window with a percentage', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))

  const answer = await $.command.run(usageInput)
  expect(answer.text).toMatch(/context \d+\/\d+ tokens \(\d+% used\)/)
})

test('/pulse-report counts tool calls that happened this session', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: 'README.md' })

  const answer = await $.command.run(reportInput)
  expect(answer.text).toContain('tool-call attempts: 2')
  expect(answer.text).toContain('Bash')
})
