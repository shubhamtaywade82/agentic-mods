import { expect, test } from 'claude-code/testing'

function commandInput(command: string) {
  return {
    command,
    args: '',
    origin: { kind: 'plugin', name: 'evidence-gate' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const
}

/**
 * A workspace with strength evidence configured: a test command, a declared strength command
 * (a fake mutation tool that prints a StrykerJS-style score) and git answering cleanly.
 */
const STRYKER_REPORT = [
  'All tests',
  'Killed : 37 (74%)',
  'Survived: 13 (26%)',
  'Mutation score: 74.00%',
].join('\n')

function configJson(gateMode: 'enforce' | 'warn', threshold: number): string {
  return JSON.stringify({
    evidence: {
      required: ['test', 'strength'],
      commands: {
        test: [['fake-test-runner']],
        strength: [['fake-mutate', 'run']],
      },
      gateMode,
      strength: { enabled: true, threshold, budgetMs: 120_000, scope: 'suite' },
    },
  })
}

type FakeRun = { stdout: string; exitCode: number; throw: boolean }

function stubEngine(
  on: Parameters<Parameters<typeof test>[1]>[1],
  options: {
    config: string
    mutateReport?: FakeRun
    store?: Map<string, unknown>
    processCalls?: string[][]
  },
): void {
  const missing = (): never => {
    throw new Error('ENOENT: no such file')
  }
  const store = options.store ?? new Map<string, unknown>()
  const processCalls = options.processCalls ?? []
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_$, e) => {
    const event = e as { key: string; value: unknown }
    store.set(event.key, event.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    if (path === '.agentic-mods/config.json') return { value: options.config }
    throw missing()
  })
  on('fs.stat', missing)
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    processCalls.push([...argv])
    const head = argv[0] ?? ''
    if (head === 'git') {
      return { value: { stdout: '', stderr: '', exitCode: 0 } }
    }
    if (head === 'fake-test-runner') {
      return { value: { stdout: 'suite ok', stderr: '', exitCode: 0 } }
    }
    if (head === 'fake-mutate') {
      const planned = options.mutateReport
      if (planned === undefined) return { value: { stdout: '', stderr: '', exitCode: 0 } }
      if (planned.throw) throw new Error('command timed out')
      return { value: { stdout: planned.stdout, stderr: '', exitCode: planned.exitCode } }
    }
    return { value: { stdout: '', stderr: '', exitCode: 0 } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

test('/evidence run shows the mutation score as a strength verdict', async ($, on) => {
  stubEngine(on, {
    config: configJson('enforce', 60),
    mutateReport: { stdout: STRYKER_REPORT, exitCode: 0, throw: false },
  })
  const answer = await $.command.run({ ...commandInput('evidence'), args: 'run' })
  expect(answer.text).toContain('strength: PASS')
  expect(answer.text).toContain('mutation score 74%')
  expect(answer.text).toContain('(37/50 mutants killed)')
})

test('a strength score below the threshold is a FAIL verdict with the threshold named', async ($, on) => {
  const lowScore = STRYKER_REPORT.replace('74.00', '42.00').replace('37 (74%)', '21 (42%)')
  stubEngine(on, {
    config: configJson('enforce', 60),
    mutateReport: { stdout: lowScore, exitCode: 1, throw: false },
  })
  const answer = await $.command.run({ ...commandInput('evidence'), args: 'run' })
  expect(answer.text).toContain('strength: FAIL')
  expect(answer.text).toContain('below threshold 60%')
})

test('strength runs after the test check in the chain', async ($, on) => {
  const calls: string[][] = []
  stubEngine(on, {
    config: configJson('enforce', 60),
    processCalls: calls,
    mutateReport: { stdout: STRYKER_REPORT, exitCode: 0, throw: false },
  })
  await $.command.run({ ...commandInput('evidence'), args: 'run' })
  const order = calls
    .filter((argv) => argv[0] === 'fake-test-runner' || argv[0] === 'fake-mutate')
    .map((argv) => argv[0])
  expect(order.join(',')).toBe('fake-test-runner,fake-mutate')
})

test('a strength run that hits its budget is incomplete, never skipped', async ($, on) => {
  stubEngine(on, {
    config: configJson('enforce', 60),
    mutateReport: { stdout: '', exitCode: 0, throw: true },
  })
  const answer = await $.command.run({ ...commandInput('evidence'), args: 'run' })
  expect(answer.text).toContain('strength: UNKNOWN')
  expect(answer.text).toContain('incomplete: budget of 120000 ms exceeded')
})

test('enforce blocks a git commit when the strength score is below the threshold', async ($, on) => {
  const lowScore = STRYKER_REPORT.replace('74.00', '42.00').replace('37 (74%)', '21 (42%)')
  stubEngine(on, {
    config: configJson('enforce', 60),
    mutateReport: { stdout: lowScore, exitCode: 1, throw: false },
  })
  await $.command.run({ ...commandInput('evidence'), args: 'run' })
  const res = (await $.tool
    .call({ tool: 'Bash', command: 'git commit -m "wip"' })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(res.deny ?? '').toContain('strength FAIL')
  expect(res.deny ?? '').toContain('below threshold')
})

test('warn mode never blocks a git commit, even below the threshold', async ($, on) => {
  const lowScore = STRYKER_REPORT.replace('74.00', '42.00').replace('37 (74%)', '21 (42%)')
  stubEngine(on, {
    config: configJson('warn', 60),
    mutateReport: { stdout: lowScore, exitCode: 1, throw: false },
  })
  await $.command.run({ ...commandInput('evidence'), args: 'run' })
  const outcome = await $.tool
    .call({ tool: 'Bash', command: 'git commit -m "wip"' })
    .then(
      () => 'allowed',
      () => 'denied',
    )
  expect(outcome).toBe('allowed')
})

test('/evidence shows the score trend across recent runs from the recorded ledger', async ($, on) => {
  const store = new Map<string, unknown>()
  const report = { stdout: STRYKER_REPORT, exitCode: 0, throw: false }
  const calls: string[][] = []
  stubEngine(on, {
    config: configJson('enforce', 60),
    store,
    processCalls: calls,
    mutateReport: report,
  })
  await $.command.run({ ...commandInput('evidence'), args: 'run' })
  report.stdout = STRYKER_REPORT.replace('74.00', '68.00').replace('37 (74%)', '34 (68%)')
  await $.command.run({ ...commandInput('evidence'), args: 'run strength' })
  const answer = await $.command.run(commandInput('evidence'))
  expect(answer.text).toContain('strength trend: 74 \u2192 68')
})

test('evidence-gate lets a harmless Bash call through', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  const outcome = await $.tool.call({ tool: 'Bash', command: 'ls' }).then(
    () => 'allowed',
    () => 'denied',
  )
  expect(outcome).toBe('allowed')
})
