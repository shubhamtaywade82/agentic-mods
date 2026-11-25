// Session-level tests for the trace mod: events feed the store and /trace
// reflects what happened.

import { expect, test } from 'claude-code/testing'

const traceInput = {
  command: 'trace-tree',
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

test('/trace-tree shows the main agent after session start', async ($) => {
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

test('a tool that finished stays completed after the turn ends', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: 'done' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ reason: 'answer', answer: 'done' } as never).catch(() => undefined)

  const answer = await $.command.run(summaryInput)
  expect(answer.text).toContain('1 completed')
  expect(answer.text).not.toContain('cancelled')
})

test('a command name taken by another plugin does not stop the other commands registering', async ($, on) => {
  const registered: string[] = []
  const toasts: string[] = []
  on('command.register', (_$, e) => {
    const name = (e as unknown as { name: string }).name
    if (name === 'trace-tree')
      throw new Error('"/trace-tree" refused: it is the plugin\'s /other:trace-tree')
    registered.push(name)
    return { value: { command: name } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/repo' }))

  await $.session.start({ cwd: '/repo' } as never)
  expect(registered).toContain('trace-summary')
  expect(toasts.join(' ')).toContain('/trace-tree')
})
