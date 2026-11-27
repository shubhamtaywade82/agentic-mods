// The measurement summary: convergence, attempts, denials, tokens and time, with null where the kit
// reports nothing. Inputs are shaped like the kit's OrchestrationReport and stored execution records.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderKitRunMetrics, summarizeKitRun } from '../src/kit-measure'

const REPORT = {
  featureId: 'GOLDEN-001',
  status: 'completed',
  tasks: [{ taskId: 'TASK-001', phase: 'refactor', completed: true, records: 3 }],
  executions: [
    { executionId: 'e1', taskId: 'TASK-001', phase: 'red', attempt: 1 },
    { executionId: 'e2', taskId: 'TASK-001', phase: 'green', attempt: 1 },
    { executionId: 'e3', taskId: 'TASK-001', phase: 'green', attempt: 2 },
    { executionId: 'e4', taskId: 'TASK-001', phase: 'refactor', attempt: 1 },
  ],
  startedAt: '2026-11-27T10:00:00.000Z',
  completedAt: '2026-11-27T10:04:30.000Z',
}

const RECORDS = [
  {
    usage: { inputTokens: 1000, outputTokens: 200 },
    events: [
      { type: 'tool.result', status: 'succeeded' },
      { type: 'tool.result', status: 'denied' },
    ],
  },
  {
    result: { usage: { inputTokens: 500, outputTokens: 50 } },
    events: [{ type: 'tool.result', status: 'denied' }],
  },
]

test('a completed run converges, with attempts per phase and the denials counted', () => {
  const metrics = summarizeKitRun(REPORT, RECORDS)
  assert.equal(metrics.converged, true)
  assert.equal(metrics.tasksCompleted, 1)
  assert.equal(metrics.tasksTotal, 1)
  assert.equal(metrics.executions, 4)
  assert.equal(metrics.attempts['TASK-001 green'], 2, 'a retry is a second attempt, not a new task')
  assert.equal(metrics.denials, 2)
  assert.equal(metrics.inputTokens, 1500)
  assert.equal(metrics.outputTokens, 250)
  assert.equal(metrics.durationMs, 270_000)
})

test('a run the kit did not complete does not converge', () => {
  const metrics = summarizeKitRun({ ...REPORT, status: 'verification_failed' }, [])
  assert.equal(metrics.converged, false)
  assert.equal(metrics.status, 'verification_failed')
})

test('tokens are null when no record reports usage, never zero', () => {
  const metrics = summarizeKitRun(REPORT, [{ events: [] }])
  assert.equal(metrics.inputTokens, null)
  assert.equal(metrics.outputTokens, null)
  assert.equal(metrics.denials, 0)
})

test('a report that is not the kit shape is refused, not measured', () => {
  assert.throws(() => summarizeKitRun('not a report', []))
  assert.throws(() => summarizeKitRun({ featureId: 'X', status: 'completed' }, []))
  assert.throws(() => summarizeKitRun({ ...REPORT, executions: [{ taskId: 'TASK-001' }] }, []))
})

test('the rendered summary names the attempts and says what was not reported', () => {
  const text = renderKitRunMetrics(summarizeKitRun(REPORT, [{ events: [] }]))
  assert.match(text, /converged/)
  assert.match(text, /TASK-001 green: 2 attempts/)
  assert.match(text, /uncached input \/ output tokens: not reported/)
})
