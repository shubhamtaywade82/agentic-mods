// Session-level tests for the verify mod. Only operator-declared checks run. Text after the command
// is a check name, so an argument that looks like a shell command is refused and never executed.
// The success path (declared commands run in order, a failure stops the run) is covered by the pure
// unit tests in packages/core/test/verify.test.ts, which run without an engine session.

import { expect, test } from 'claude-code/testing'

const runInput = (args: string) =>
  ({
    command: 'verify-run',
    args,
    origin: { kind: 'plugin', name: 'verify' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

const statusInput = {
  command: 'verify-status',
  args: '',
  origin: { kind: 'plugin', name: 'verify' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('/verify-run with no args explains how to use it', async ($) => {
  const answer = await $.command.run(runInput(''))
  expect(answer.text).toContain('usage: /verify-run <check>')
})

test('/verify-run refuses an unknown check name and runs nothing', async ($, on) => {
  const seen: unknown[] = []
  on('process.run', (_$, e) => {
    seen.push((e as { argv?: unknown }).argv)
    return { value: { stdout: '', stderr: '', exitCode: 0 } }
  })

  const answer = await $.command.run(runInput('deploy'))
  expect(answer.text).toContain('unknown check "deploy"')
  expect(seen.length).toBe(0)
})

test('/verify-run never splits free text into a command', async ($, on) => {
  const seen: unknown[] = []
  on('process.run', (_$, e) => {
    seen.push((e as { argv?: unknown }).argv)
    return { value: { stdout: '', stderr: '', exitCode: 0 } }
  })

  const answer = await $.command.run(runInput('echo hi; touch pwned'))
  expect(answer.text).toContain('unknown check')
  expect(seen.length).toBe(0)
})

test('/verify-status reports no runs before any check ran', async ($) => {
  const answer = await $.command.run(statusInput)
  expect(answer.text).toContain('verify: no runs this session.')
})
