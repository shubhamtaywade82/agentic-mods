// Behaviour of /verify-run through the engine: only declared commands run, each once, and a
// destructive declared command is refused before anything is launched.

import { expect, test } from 'claude-code/testing'

const CONFIG = JSON.stringify({
  evidence: {
    commands: {
      test: [
        ['pnpm', 'test'],
        ['pnpm', 'test:core'],
      ],
      build: [['rm', '-rf', 'dist']],
    },
  },
})

function runInput(args: string) {
  return {
    command: 'verify-run',
    args,
    origin: { kind: 'plugin', name: 'verify' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const
}

const statusInput = {
  command: 'verify-status',
  args: '',
  origin: { kind: 'plugin', name: 'verify' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

type Stub = Parameters<Parameters<typeof test>[1]>[1]

/** A repository whose only configuration is CONFIG. Launches record argv and exit codes in order. */
function stubEngine(on: Stub, launches: string[][], exitCodes: number[]): void {
  const missing = (): never => {
    throw new Error('ENOENT: no such file')
  }
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.read', (_$, e) => {
    const path = String((e as { path?: unknown }).path ?? '')
    return path.endsWith('config.json') ? { value: CONFIG } : missing()
  })
  on('fs.stat', missing)
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    launches.push([...argv])
    const exitCode = exitCodes[launches.length - 1] ?? 0
    return { value: { stdout: `ran ${argv.join(' ')}`, stderr: '', exitCode } }
  })
}

test('a declared check runs every declared command in order and passes', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [0, 0])
  const answer = await $.command.run(runInput('test'))
  expect(answer.text).toContain('verify test: PASS')
  expect(launches).toEqual([
    ['pnpm', 'test'],
    ['pnpm', 'test:core'],
  ])
})

test('a failing command stops the run and is never retried', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [1])
  const answer = await $.command.run(runInput('test'))
  expect(answer.text).toContain('verify test: FAIL')
  expect(launches.length).toBe(1)
  expect(answer.text).toContain('1 declared command(s) not run')
})

test('a destructive declared command is refused and nothing is launched', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [])
  const answer = await $.command.run(runInput('build'))
  expect(answer.text).toContain('declared command refused')
  expect(launches.length).toBe(0)
})

test('free text after the command is refused as a check name, never executed', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [])
  const answer = await $.command.run(runInput('echo hi; touch pwned'))
  expect(answer.text).toContain('unknown check')
  expect(launches.length).toBe(0)
})

test('a check with nothing declared is refused', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [])
  const answer = await $.command.run(runInput('lint'))
  expect(answer.text).toContain('no command is declared for lint')
  expect(launches.length).toBe(0)
})

test('/verify-run with no argument lists only the checks that can run', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [])
  const answer = await $.command.run(runInput(''))
  expect(answer.text).toContain('Declared checks: test')
  expect(answer.text).not.toContain('build')
})

test('/verify-status counts the checks run this session', async ($, on) => {
  const launches: string[][] = []
  stubEngine(on, launches, [0, 0])
  await $.command.run(runInput('test'))
  const answer = await $.command.run(statusInput)
  expect(answer.text).toContain('runs: 1 (passed 1, failed 0)')
})
