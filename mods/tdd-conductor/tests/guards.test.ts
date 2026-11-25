import { expect, test } from 'claude-code/testing'

const tddInput = (args: string) =>
  ({
    command: 'tdd-cycle',
    args,
    origin: { kind: 'plugin', name: 'tdd-conductor' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

function stubStore(on: Parameters<Parameters<typeof test>[1]>[1], phase: string) {
  on('store.get', (_$, e) => ({
    value: (e as { key: string }).key === 'phase' ? phase : undefined,
  }))
  on('store.set', () => ({ value: undefined }))
}

test('a notebook edit to production code is refused before a failing test exists', async ($, on) => {
  stubStore(on, 'idle')
  on('tool.call', () => ({ result: 'ok' }))
  const res = (await $.tool
    .call({ tool: 'NotebookEdit', notebook_path: '/repo/analysis.ipynb', new_source: 'x' })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(res.deny ?? '').toContain('production code')
})

test('a second exception is appended to the log, not written over the first', async ($, on) => {
  stubStore(on, 'red')
  let log = ''
  on('fs.read', () => {
    if (log === '') throw new Error('ENOENT')
    return { value: log }
  })
  on('fs.write', (_$, e) => {
    log = String((e as { text?: unknown }).text)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  await $.command.run(tddInput('exception spike for the parser'))
  await $.command.run(tddInput('exception hotfix for prod'))
  expect(log).toContain('spike for the parser')
  expect(log).toContain('hotfix for prod')
})

test('a green run during refactor verifies the refactor', async ($, on) => {
  let phase = 'refactor'
  on('store.get', (_$, e) => ({
    value: (e as { key: string }).key === 'phase' ? phase : undefined,
  }))
  on('store.set', (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    if (key === 'phase') phase = String(value)
    return { value: undefined }
  })
  on('fs.read', () => ({ value: '{"command": ["npx", "vitest", "run"]}' }))
  on('process.run', () => ({ value: { stdout: 'ok', stderr: '', exitCode: 0 } }))

  const answer = await $.command.run(tddInput('green src/a.test.ts'))
  expect(answer.text).toContain('REFACTOR verified')
  expect(phase).toBe('refactor')
})
