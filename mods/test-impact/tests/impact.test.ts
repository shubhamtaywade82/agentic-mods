import { expect, test } from 'claude-code/testing'

const impactInput = {
  command: 'impact',
  args: '',
  origin: { kind: 'plugin', name: 'test-impact' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const FILES: Record<string, string> = {
  'src/a.ts': 'export const a = 1\n',
  'src/a.test.ts': "import { a } from './a'\n",
  'src/new.ts': 'export const fresh = 2\n',
}

function stubRepo(on: Parameters<Parameters<typeof test>[1]>[1], status: string): void {
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv[1] === 'ls-files')
      return { value: { stdout: 'src/a.ts\0src/a.test.ts\0', stderr: '', exitCode: 0 } }
    return { value: { stdout: status, stderr: '', exitCode: 0 } }
  })
  on('fs.stat', () => ({ value: { size: 100 } }))
  on('fs.read', (_$, e) => ({ value: FILES[(e as { path: string }).path] ?? '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('a new untracked source file is reported as untested', async ($, on) => {
  stubRepo(on, '?? src/new.ts\0')
  const answer = await $.command.run(impactInput)
  expect(answer.text).toContain('changed code with no test reaching it: src/new.ts')
})

test('an edited test file is selected to run', async ($, on) => {
  stubRepo(on, ' M src/a.test.ts\0')
  const answer = await $.command.run(impactInput)
  expect(answer.text).toContain('tests to run (1): src/a.test.ts')
})

test('a failing git status means the impact is unknown', async ($, on) => {
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv[1] === 'ls-files') return { value: { stdout: 'src/a.ts\0', stderr: '', exitCode: 0 } }
    return { value: { stdout: '', stderr: 'fatal', exitCode: 128 } }
  })
  on('fs.stat', () => ({ value: { size: 100 } }))
  on('fs.read', () => ({ value: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const answer = await $.command.run(impactInput)
  expect(answer.text).toContain('Run the full suite')
})
