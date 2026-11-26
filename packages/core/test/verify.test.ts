// Declared-check verification: only operator-declared commands run, each once, with no retry, and a
// failed or throwing launch is a failure rather than a pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseConfig, type AgenticConfig } from '../src/config'
import {
  configuredChecks,
  renderCheckRun,
  runSelectedCheck,
  selectCheck,
  type Exec,
} from '../src/verify'

function configWith(commands: AgenticConfig['evidence']['commands']): AgenticConfig {
  const parsed = parseConfig(undefined).value
  return { ...parsed, evidence: { ...parsed.evidence, commands } }
}

const config = configWith({
  lint: [['pnpm', 'lint']],
  test: [
    ['pnpm', 'test'],
    ['pnpm', 'test:core'],
  ],
  build: [['rm', '-rf', 'dist']],
})

test('selectCheck refuses an unknown check name', () => {
  const selection = selectCheck(config, 'deploy')
  assert.equal(selection.ok, false)
  if (!selection.ok) assert.match(selection.reason, /unknown check "deploy"/)
})

test('selectCheck refuses a check with nothing declared', () => {
  const selection = selectCheck(config, 'security')
  assert.equal(selection.ok, false)
  if (!selection.ok) assert.match(selection.reason, /no command is declared for security/)
})

test('selectCheck refuses a declared command that the process policy denies', () => {
  const selection = selectCheck(config, 'build')
  assert.equal(selection.ok, false)
  if (!selection.ok) assert.match(selection.reason, /declared command refused/)
})

test('selectCheck accepts a declared check and returns its argv list', () => {
  const selection = selectCheck(config, ' test ')
  assert.equal(selection.ok, true)
  if (selection.ok) assert.equal(selection.commands.length, 2)
})

test('configuredChecks lists only the checks that have commands', () => {
  assert.deepEqual(configuredChecks(config), ['test', 'lint'])
})

test('runs declared commands in order and passes only when all exit 0', async () => {
  const calls: string[][] = []
  const exec: Exec = async (argv) => {
    calls.push([...argv])
    return { exitCode: 0, output: 'ok' }
  }
  const selection = selectCheck(config, 'test')
  if (!selection.ok) assert.fail(selection.reason)
  const run = await runSelectedCheck(selection, exec)
  assert.equal(run.passed, true)
  assert.deepEqual(calls, [
    ['pnpm', 'test'],
    ['pnpm', 'test:core'],
  ])
})

test('stops at the first failure and never retries it', async () => {
  let calls = 0
  const exec: Exec = async () => {
    calls += 1
    return { exitCode: 1, output: 'Error: request timed out, retry later' }
  }
  const selection = selectCheck(config, 'test')
  if (!selection.ok) assert.fail(selection.reason)
  const run = await runSelectedCheck(selection, exec)
  assert.equal(run.passed, false)
  assert.equal(calls, 1, 'a failed step is executed exactly once')
  assert.equal(run.steps.length, 1)
  assert.match(renderCheckRun(run), /1 declared command\(s\) not run/)
})

test('a launch that throws is a failed step, not a pass or a crash', async () => {
  const exec: Exec = async () => {
    throw new Error('spawn ENOENT')
  }
  const selection = selectCheck(config, 'lint')
  if (!selection.ok) assert.fail(selection.reason)
  const run = await runSelectedCheck(selection, exec)
  assert.equal(run.passed, false)
  assert.equal(run.steps[0]?.exitCode, 1)
  assert.match(run.steps[0]?.tail ?? '', /launch failed: spawn ENOENT/)
})
