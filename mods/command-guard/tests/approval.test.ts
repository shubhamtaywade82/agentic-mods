import { expect, test } from 'claude-code/testing'

function noConfig(on: Parameters<Parameters<typeof test>[1]>[1]): void {
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
}

test('a confirm-level command is put to one permission dialog, not a separate question', async ($, on) => {
  noConfig(on)
  let questions = 0
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') questions += 1
    return { result: 'ok' }
  })
  const verdict = await $.tool.check({
    tool: 'Bash',
    input: { command: 'git push --force origin main' },
  })
  expect(verdict.decision).toBe('ask')
  expect(verdict.reason ?? '').toContain('command-guard')
  expect(questions).toBe(0)
})
