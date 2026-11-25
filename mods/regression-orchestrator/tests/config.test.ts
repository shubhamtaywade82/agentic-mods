import { expect, test } from 'claude-code/testing'

test('a malformed regression.json is reported, not treated as missing', async ($, on) => {
  on('fs.read', () => ({ value: '{ not json' }))
  on('fs.stat', () => ({ value: { size: 10 } }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0 } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const answer = await $.command.run({
    command: 'regression',
    args: 'run',
    origin: { kind: 'plugin', name: 'regression-orchestrator' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const)
  expect(answer.text).toContain('regression.json')
  expect(answer.text).toContain('not valid JSON')
})
