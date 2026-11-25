// Unit tests for verify's pure policy lib + the packages/core verifyEngine.
//
// These exercise the full classify -> route -> execute -> verify -> escalate
// loop against stubbed execute/verify effects, with no Claude Code session.

import { expect, test } from 'claude-code/testing'
import { verifyEngine, type RunOutcome, type VerificationResult } from '@agentic-mods/core'
import {
  DEFAULT_POLICY,
  STRICT_POLICY,
  containsCheck,
  heuristicClassify,
  heuristicClassifyFailure,
  nonEmptyCheck,
  renderOutcome,
  renderStatus,
  runChecks,
} from '../hooks/lib/policy'

// --------------------------------------------------------------- classifier

test('heuristicClassify flags complex/risky tasks', () => {
  const hard = heuristicClassify({ task: 'refactor the security-critical migration', agentType: 'main' })
  expect(hard.complexity).toBe(0.8)
  expect(hard.risk).toBe(0.8)
  expect(hard.effort).toBe('high')

  const easy = heuristicClassify({ task: 'fix a typo in the README', agentType: 'main' })
  expect(easy.effort).toBe('low')
  expect(easy.risk).toBe(0.2)
})

test('heuristicClassifyFailure maps timeouts to transient, wrong-model to route-mismatch', () => {
  expect(
    heuristicClassifyFailure({ passed: false, failures: ['request timed out'], evidence: [] }).category,
  ).toBe('transient')
  expect(
    heuristicClassifyFailure({ passed: false, failures: ['wrong model for this task'], evidence: [] }).category,
  ).toBe('route-mismatch')
  expect(
    heuristicClassifyFailure({ passed: false, failures: ['fatal unrecoverable error'], evidence: [] }).category,
  ).toBe('fatal')
  expect(
    heuristicClassifyFailure({ passed: false, failures: ['assertion failed'], evidence: [] }).category,
  ).toBe('deterministic')
})

// --------------------------------------------------------------- built-in checks

test('nonEmptyCheck passes on non-empty string output', async () => {
  expect((await nonEmptyCheck.run('hello')).passed).toBe(true)
  expect((await nonEmptyCheck.run('')).passed).toBe(false)
  expect((await nonEmptyCheck.run('   ')).passed).toBe(false)
})

test('containsCheck matches the substring', async () => {
  const c = containsCheck('PASS')
  expect((await c.run('tests PASS')).passed).toBe(true)
  expect((await c.run('tests FAIL')).passed).toBe(false)
})

test('runChecks passes only when every check passes', async () => {
  const r1 = await runChecks('hello PASS', [nonEmptyCheck, containsCheck('PASS')])
  expect(r1.passed).toBe(true)
  const r2 = await runChecks('hello', [nonEmptyCheck, containsCheck('PASS')])
  expect(r2.passed).toBe(false)
  expect(r2.failures.length).toBe(1)
})

// ----------------------------------------------------------- the full engine

const passVerify = async (_output: unknown): Promise<VerificationResult> => ({ passed: true, failures: [], evidence: [] })

const failVerify = async (_output: unknown): Promise<VerificationResult> => ({
  passed: false,
  failures: ['wrong model for this task'],
  evidence: [],
})

test('the engine completes on the first attempt when verification passes', async () => {
  let executed = 0
  const outcome = await verifyEngine.run({
    initial: { model: 'haiku', effort: 'low' },
    policy: DEFAULT_POLICY,
    classifyFailure: heuristicClassifyFailure,
    execute: async () => {
      executed += 1
      return 'done'
    },
    verify: passVerify,
  })
  expect(outcome.status).toBe('completed')
  expect(outcome.attempts).toHaveLength(1)
  expect(executed).toBe(1)
})

test('the engine escalates the route on a route-mismatch failure', async () => {
  let executed = 0
  const seenModels: string[] = []
  const outcome = await verifyEngine.run({
    initial: { model: 'claude-haiku-4.5', effort: 'low' },
    policy: DEFAULT_POLICY,
    classifyFailure: heuristicClassifyFailure,
    execute: async (route) => {
      executed += 1
      seenModels.push(route.model)
      // Pass only on the strongest model (the last fallback route).
      return route.model === 'claude-opus-4.1' ? 'good' : 'weak'
    },
    verify: async (output) => {
      const ok = output === 'good'
      return ok ? { passed: true, failures: [], evidence: [] } : { passed: false, failures: ['wrong model for this task'], evidence: [] }
    },
  })
  expect(outcome.status).toBe('completed')
  expect(outcome.finalRoute?.model).toBe('claude-opus-4.1')
  expect(seenModels).toEqual(['claude-haiku-4.5', 'claude-sonnet-4.5', 'claude-opus-4.1'])
})

test('the engine exhausts when every fallback route fails', async () => {
  const outcome = await verifyEngine.run({
    initial: { model: 'claude-haiku-4.5', effort: 'low' },
    policy: DEFAULT_POLICY,
    classifyFailure: heuristicClassifyFailure,
    execute: async () => 'weak',
    verify: failVerify,
  })
  expect(outcome.status).toBe('exhausted')
  expect(outcome.attempts.length).toBe(DEFAULT_POLICY.maxAttempts)
})

test('the engine aborts on a non-retryable (fatal) failure', async () => {
  const outcome = await verifyEngine.run({
    initial: { model: 'haiku', effort: 'low' },
    policy: DEFAULT_POLICY,
    classifyFailure: () => ({ category: 'fatal', detail: 'unrecoverable' }),
    execute: async () => 'output',
    verify: async () => ({ passed: false, failures: ['fatal unrecoverable error'], evidence: [] }),
  })
  expect(outcome.status).toBe('aborted')
  expect(outcome.attempts).toHaveLength(1)
})

test('the strict policy makes a single attempt with no escalation', async () => {
  const outcome = await verifyEngine.run({
    initial: { model: 'opus', effort: 'high' },
    policy: STRICT_POLICY,
    classifyFailure: heuristicClassifyFailure,
    execute: async () => 'out',
    verify: failVerify,
  })
  expect(outcome.status).toBe('aborted')
  expect(outcome.attempts).toHaveLength(1)
})

test('the engine retries on a transient failure (same route)', async () => {
  let calls = 0
  const outcome = await verifyEngine.run({
    initial: { model: 'haiku', effort: 'low' },
    policy: DEFAULT_POLICY,
    classifyFailure: (f) => ({ category: 'transient', detail: f.failures[0] ?? '' }),
    execute: async () => {
      calls += 1
      return calls >= 2 ? 'ok' : 'fail'
    },
    verify: async (output) => output === 'ok' ? { passed: true, failures: [], evidence: [] } : { passed: false, failures: ['timed out'], evidence: [] },
  })
  expect(outcome.status).toBe('completed')
  expect(calls).toBe(2)
})

// --------------------------------------------------------------- rendering

test('renderOutcome shows status, final route and per-attempt lines', () => {
  const outcome: RunOutcome = {
    status: 'completed',
    finalRoute: { model: 'opus', effort: 'high' },
    attempts: [
      { attempt: 1, route: { model: 'haiku', effort: 'low' }, verification: { passed: false, failures: ['x'], evidence: [] }, failure: { category: 'route-mismatch', detail: 'x' } },
      { attempt: 2, route: { model: 'opus', effort: 'high' }, verification: { passed: true, failures: [], evidence: [] } },
    ],
  }
  const text = renderOutcome(outcome)
  expect(text).toContain('completed')
  expect(text).toContain('opus/high')
  expect(text).toContain('attempt 1')
  expect(text).toContain('attempt 2')
})

test('renderStatus handles an empty session and summarizes a populated one', () => {
  expect(renderStatus([])).toContain('no runs')
  const text = renderStatus([
    { status: 'completed', attempts: [{ attempt: 1, route: { model: 'a', effort: 'low' }, verification: { passed: true, failures: [], evidence: [] } }] },
    { status: 'exhausted', attempts: [{ attempt: 1, route: { model: 'b', effort: 'high' }, verification: { passed: false, failures: ['x'], evidence: [] } }] },
  ])
  expect(text).toContain('runs: 2')
  expect(text).toContain('completed 1')
  expect(text).toContain('exhausted 1')
})

// ----------------------------------------------------------- policy shapes

test('DEFAULT_POLICY retries transient and route-mismatch, climbs a 3-rung ladder', () => {
  expect(DEFAULT_POLICY.retryableFailures).toContain('transient')
  expect(DEFAULT_POLICY.retryableFailures).toContain('route-mismatch')
  expect(DEFAULT_POLICY.fallbackRoutes.length).toBe(3)
  expect(DEFAULT_POLICY.maxAttempts).toBe(3)
})

test('STRICT_POLICY never retries', () => {
  expect(STRICT_POLICY.maxAttempts).toBe(1)
  expect(STRICT_POLICY.retryableFailures.length).toBe(0)
})
