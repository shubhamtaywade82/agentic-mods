import { expect, test } from 'claude-code/testing'

const wrappedInput = {
  command: 'wrapped',
  args: '',
  origin: { kind: 'plugin', name: 'session-wrapped' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('a new session starts its counters from zero', async ($, on) => {
  const store = new Map<string, unknown>([
    ['sessionId', 'earlier-session'],
    ['turns', 7],
    ['tools', 40],
    ['edits', 9],
  ])
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'this-session' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', () => ({ value: { command: 'wrapped' } }))

  await $.session.start({ cwd: '/repo' } as never).catch(() => undefined)
  const answer = await $.command.run(wrappedInput)
  expect(answer.text).toContain('0 turn(s)')
  expect(answer.text).toContain('0 tool call(s)')
})
