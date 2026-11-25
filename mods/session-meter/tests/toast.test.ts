import { expect, test } from 'claude-code/testing'

const measure = (usd: number) =>
  ({
    context: { window: 200_000, tokens: 1_000 },
    rateLimits: [],
    cost: { usd },
    changed: ['cost'],
  }) as never

test('a crossed cost threshold toasts once, not on every measurement', async ($, on) => {
  const toasts: string[] = []
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  on('session.measure', () => ({ changed: ['cost'] }))

  await $.session.measure(measure(5.1)).catch(() => undefined)
  await $.session.measure(measure(5.2)).catch(() => undefined)
  await $.session.measure(measure(5.3)).catch(() => undefined)
  expect(toasts.length).toBe(1)
})
