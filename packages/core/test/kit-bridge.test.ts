// The kit bridge: parse the kit's NextAction payload strictly, build phase argv from the structured
// fields, and refuse a plan whose verification commands the process policy denies.
// The first fixture is the real `kit next FEATURE-001 --json` output from kit 0.9.1 at the red phase.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  deniedPlanCommands,
  executesVerification,
  kitOrchestrationArgv,
  kitPhaseArgv,
  parseKitNextAction,
  parseKitVersion,
  renderKitAction,
  type KitNextAction,
} from '../src/kit-bridge'

const RED_PAYLOAD = {
  schemaVersion: 1,
  featureId: 'FEATURE-001',
  status: 'in_progress',
  taskId: 'TASK-001',
  phase: 'red',
  requiredAction: 'task.red',
  verificationCommand: ['node', '/tmp/claude-0/kit-e2e/check.js'],
  nextInvocation: 'kit feature FEATURE-001 red TASK-001',
  blockingQuestions: [],
  advisoryLessons: [],
  constraints: { timeoutMs: 60000, maxOutputBytes: 10485760 },
}

function payload(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...RED_PAYLOAD, ...overrides })
}

function parsed(text: string): KitNextAction {
  const result = parseKitNextAction(text)
  if (!result.ok) assert.fail(result.error)
  return result.value
}

test('parses the real red-phase payload from kit 0.9.1', () => {
  const action = parsed(JSON.stringify(RED_PAYLOAD))
  assert.equal(action.featureId, 'FEATURE-001')
  assert.equal(action.taskId, 'TASK-001')
  assert.equal(action.phase, 'red')
  assert.equal(action.requiredAction, 'task.red')
})

test('a run-level payload parses with no task fields', () => {
  const action = parsed(
    payload({
      status: 'completed',
      taskId: undefined,
      phase: undefined,
      requiredAction: 'run.completed',
      verificationCommand: [],
      nextInvocation: 'kit feature FEATURE-001 status',
    }),
  )
  assert.equal(action.taskId, undefined)
  assert.equal(action.phase, undefined)
})

test('refuses a payload from another schema version', () => {
  const result = parseKitNextAction(payload({ schemaVersion: 2 }))
  assert.equal(result.ok, false)
})

test('refuses a featureId that is not a plain identifier', () => {
  for (const featureId of ['FEATURE-001; rm -rf /', 'A B', '../../etc', '', '-leading']) {
    const result = parseKitNextAction(payload({ featureId }))
    assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(featureId)}`)
  }
})

test('refuses an unknown required action and an unknown status', () => {
  assert.equal(parseKitNextAction(payload({ requiredAction: 'task.delete' })).ok, false)
  assert.equal(parseKitNextAction(payload({ status: 'merged' })).ok, false)
})

test('refuses a task action with no task, and a phase that disagrees with the action', () => {
  assert.equal(parseKitNextAction(payload({ taskId: undefined })).ok, false)
  assert.equal(parseKitNextAction(payload({ phase: 'green' })).ok, false)
  assert.equal(parseKitNextAction(payload({ phase: undefined })).ok, false)
})

test('refuses a run-level action that names a task', () => {
  const result = parseKitNextAction(payload({ requiredAction: 'feature.verify' }))
  assert.equal(result.ok, false)
})

test('refuses a lesson that is not marked advisory, and non-positive constraints', () => {
  const lesson = payload({ advisoryLessons: [{ lessonId: 'L1', summary: 'x', advisory: false }] })
  assert.equal(parseKitNextAction(lesson).ok, false)
  const constraints = payload({ constraints: { timeoutMs: 0, maxOutputBytes: 10 } })
  assert.equal(parseKitNextAction(constraints).ok, false)
})

test('refuses non-JSON output, such as the blocked message a kit run prints', () => {
  const result = parseKitNextAction('kit next: no active feature runs')
  assert.equal(result.ok, false)
})

test('builds phase argv from the structured fields, for each TDD phase', () => {
  const red = parsed(JSON.stringify(RED_PAYLOAD))
  assert.deepEqual(kitPhaseArgv('feature', 'FEATURE-001', red), [
    'kit',
    'feature',
    'FEATURE-001',
    'red',
    'TASK-001',
  ])
  const green = parsed(payload({ phase: 'green', requiredAction: 'task.green' }))
  assert.deepEqual(kitPhaseArgv('feature', 'FEATURE-001', green)?.slice(3), ['green', 'TASK-001'])
})

test('builds the run-level argv, and none once the run is finished', () => {
  const start = parsed(
    payload({ requiredAction: 'feature.start', taskId: undefined, phase: undefined }),
  )
  assert.deepEqual(kitPhaseArgv('feature', 'FEATURE-001', start), [
    'kit',
    'feature',
    'FEATURE-001',
    'start',
  ])
  const done = parsed(
    payload({ requiredAction: 'run.completed', taskId: undefined, phase: undefined }),
  )
  assert.equal(kitPhaseArgv('feature', 'FEATURE-001', done), null)
})

test('fix runs use the fix command family', () => {
  const red = parsed(JSON.stringify(RED_PAYLOAD))
  assert.equal(kitPhaseArgv('fix', 'FEATURE-001', red)?.[1], 'fix')
})

test('the orchestration argv runs the kit loop for a valid run id only', () => {
  assert.deepEqual(kitOrchestrationArgv('feature', 'FEATURE-001'), [
    'kit',
    'feature',
    'FEATURE-001',
    'run',
  ])
  assert.deepEqual(kitOrchestrationArgv('fix', 'BUG-101'), ['kit', 'fix', 'BUG-101', 'run'])
  assert.equal(kitOrchestrationArgv('feature', 'FEATURE-001; rm -rf /'), null)
})

test('argv never comes from nextInvocation: a tampered string changes nothing', () => {
  const tampered = parsed(
    payload({ nextInvocation: 'kit feature FEATURE-001 red TASK-001; rm -rf /' }),
  )
  assert.deepEqual(kitPhaseArgv('feature', 'FEATURE-001', tampered), [
    'kit',
    'feature',
    'FEATURE-001',
    'red',
    'TASK-001',
  ])
})

test('refuses argv for a payload that describes a different run', () => {
  const red = parsed(JSON.stringify(RED_PAYLOAD))
  assert.equal(kitPhaseArgv('feature', 'FEATURE-999', red), null)
})

test('only the task and verify phases execute verification commands', () => {
  assert.equal(executesVerification(parsed(JSON.stringify(RED_PAYLOAD))), true)
  const start = parsed(
    payload({ requiredAction: 'feature.start', taskId: undefined, phase: undefined }),
  )
  assert.equal(executesVerification(start), false)
})

test('a plan whose verification commands the policy allows has no denials', () => {
  const plan = JSON.stringify({
    tasks: [{ id: 'TASK-001', verification: { command: ['pnpm', 'test'] } }],
  })
  const result = deniedPlanCommands(plan)
  assert.deepEqual(result, { ok: true, value: [] })
})

test('a plan that hides a destructive verification command is refused', () => {
  const plan = JSON.stringify({
    tasks: [
      { id: 'TASK-001', verification: { command: ['pnpm', 'test'] } },
      { id: 'TASK-002', verification: { command: ['rm', '-rf', 'dist'] } },
    ],
  })
  const result = deniedPlanCommands(plan)
  assert.equal(result.ok, true)
  if (result.ok) assert.match(result.value.join('\n'), /TASK-002/)
})

test('a task with no verification command is reported, not skipped', () => {
  const result = deniedPlanCommands(JSON.stringify({ tasks: [{ id: 'TASK-003' }] }))
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, ['TASK-003: no verification command'])
})

test('an unreadable or malformed plan is an error, never an empty list', () => {
  assert.equal(deniedPlanCommands('not json').ok, false)
  assert.equal(deniedPlanCommands('{}').ok, false)
})

test('the kit version is read from its output and nothing else is accepted', () => {
  assert.equal(parseKitVersion('0.9.1\n'), '0.9.1')
  assert.equal(parseKitVersion('command not found'), null)
})

test('the rendered action names the phase and the next command, and never runs it', () => {
  const text = renderKitAction(parsed(JSON.stringify(RED_PAYLOAD)), 'feature')
  assert.match(text, /feature run FEATURE-001 \(in_progress\): TASK-001 red/)
  assert.match(text, /Next: kit feature FEATURE-001 red TASK-001/)
})
