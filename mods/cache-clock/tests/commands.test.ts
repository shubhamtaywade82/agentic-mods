import { expect, test } from 'claude-code/testing'

test('cache-clock lets a harmless Bash call through', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  const outcome = await $.tool.call({ tool: 'Bash', command: 'ls' }).then(
    () => 'allowed',
    () => 'denied',
  )
  expect(outcome).toBe('allowed')
})
