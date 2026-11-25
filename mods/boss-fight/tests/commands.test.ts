import { expect, test } from 'claude-code/testing'

function commandInput(command: string) {
  return {
    command,
    args: '',
    origin: { kind: 'plugin', name: 'boss-fight' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const
}

// An empty workspace: no stored values, no files, git and shell commands print nothing.
function stubEngine(on: Parameters<Parameters<typeof test>[1]>[1]): void {
  const missing = (): never => {
    throw new Error('ENOENT: no such file')
  }
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.read', missing)
  on('fs.stat', missing)
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0 } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

test('boss-fight lets a harmless Bash call through', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  const outcome = await $.tool.call({ tool: 'Bash', command: 'ls' }).then(
    () => 'allowed',
    () => 'denied',
  )
  expect(outcome).toBe('allowed')
})
