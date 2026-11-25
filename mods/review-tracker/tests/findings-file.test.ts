import { expect, test } from 'claude-code/testing'

const findingInput = (args: string) =>
  ({
    command: 'finding',
    args,
    origin: { kind: 'plugin', name: 'review-tracker' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

test('a corrupt findings file is reported and never overwritten', async ($, on) => {
  const writes: string[] = []
  on('fs.stat', () => ({ value: { size: 10 } }))
  on('fs.read', () => ({ value: '{ not json' }))
  on('fs.write', (_$, e) => {
    writes.push(String((e as { path?: unknown }).path))
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const answer = await $.command.run(findingInput('add high leaked token'))
  expect(answer.text).toContain('findings.json')
  expect(answer.text).toContain('cannot be read')
  expect(writes.length).toBe(0)
})

test('a missing findings file starts an empty list', async ($, on) => {
  on('fs.stat', () => {
    throw new Error('ENOENT: no such file')
  })
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))

  const answer = await $.command.run(findingInput('add high leaked token'))
  expect(answer.text).toBe('R-001 recorded as high.')
})
