import { expect, test } from 'claude-code/testing'

const nextInput = {
  command: 'next-steps',
  args: '',
  origin: { kind: 'plugin', name: 'next-steps' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

function stubStore(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: 'done' }))
}

test('a turn whose only edit was denied does not suggest checking changes', async ($, on) => {
  stubStore(on)
  on('tool.call', () => ({ deny: 'blocked by another mod' }))
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' }).catch(() => undefined)
  await $.turn.complete({ reason: 'answer', answer: 'done' } as never).catch(() => undefined)
  const answer = await $.command.run(nextInput)
  expect(answer.text).not.toContain('/evidence run')
})

test('a turn with a successful edit suggests checking changes', async ($, on) => {
  stubStore(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ reason: 'answer', answer: 'done' } as never).catch(() => undefined)
  const answer = await $.command.run(nextInput)
  expect(answer.text).toContain('/evidence run')
})
