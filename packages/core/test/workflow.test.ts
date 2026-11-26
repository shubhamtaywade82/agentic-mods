// Workflow gates must fail closed. A missing gate, a gate with no facts, a prototype key used as a
// gate id, and a dangling reference in the catalogue must each block a transition.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  advanceRun,
  evaluateGate,
  gateOf,
  parseGates,
  parseWorkflow,
  startRun,
  validateCatalogue,
  type FactValue,
  type GateDefinition,
  type WorkflowDefinition,
} from '../src/workflow'

const specGate: GateDefinition = {
  id: 'spec-gate',
  description: 'spec',
  facts: ['spec-valid', 'spec-reviewed'],
}
const gates: Record<string, GateDefinition> = { 'spec-gate': specGate }

const definition: WorkflowDefinition = {
  id: 'demo',
  description: 'demo',
  start: 'spec',
  stages: [
    { id: 'spec', name: 'Spec', gate: 'spec-gate', artifact: null, next: ['build'] },
    { id: 'build', name: 'Build', gate: null, artifact: null, next: ['done'] },
    { id: 'done', name: 'Done', gate: null, artifact: null, next: [] },
  ],
}

const allPass: Record<string, FactValue> = { 'spec-valid': 'PASS', 'spec-reviewed': 'PASS' }

test('a stage whose gate is not in the catalogue cannot advance', () => {
  const broken: WorkflowDefinition = {
    ...definition,
    stages: definition.stages.map((s) =>
      s.id === 'spec' ? { ...s, gate: 'specification-gate' } : s,
    ),
  }
  const run = startRun(broken, 'r1', 'T-1', 0)
  const result = advanceRun(broken, gates, run, 'build', allPass, 1)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /not in the gate catalogue/)
})

test('a gate with no facts is never satisfied', () => {
  const empty: GateDefinition = { id: 'empty', description: '', facts: [] }
  const evaluation = evaluateGate(empty, allPass, [])
  assert.equal(evaluation.allowed, false)
  assert.match(evaluation.invalid ?? '', /no facts/)

  const run = startRun(definition, 'r2', 'T-2', 0)
  const result = advanceRun(definition, { 'spec-gate': empty }, run, 'build', allPass, 1)
  assert.equal(result.ok, false)
})

test('a prototype key used as a gate id is not treated as a gate', () => {
  assert.equal(gateOf(gates, 'constructor'), undefined)
  assert.equal(gateOf(gates, 'toString'), undefined)
  assert.equal(gateOf(gates, '__proto__'), undefined)
  const sneaky: WorkflowDefinition = {
    ...definition,
    stages: definition.stages.map((s) => (s.id === 'spec' ? { ...s, gate: 'constructor' } : s)),
  }
  const run = startRun(sneaky, 'r3', 'T-3', 0)
  assert.equal(advanceRun(sneaky, gates, run, 'build', allPass, 1).ok, false)
})

test('a FAIL fact blocks and is reported as failing', () => {
  const evaluation = evaluateGate(specGate, { ...allPass, 'spec-reviewed': 'FAIL' }, [])
  assert.equal(evaluation.allowed, false)
  assert.deepEqual(evaluation.failing, ['spec-reviewed'])
})

test('an UNKNOWN or absent fact blocks as missing', () => {
  const evaluation = evaluateGate(specGate, { 'spec-valid': 'PASS' }, [])
  assert.equal(evaluation.allowed, false)
  assert.deepEqual(evaluation.missing, ['spec-reviewed'])
})

test('DEFERRED blocks without an approved exception, and passes with one', () => {
  const facts: Record<string, FactValue> = { 'spec-valid': 'PASS', 'spec-reviewed': 'DEFERRED' }
  assert.equal(evaluateGate(specGate, facts, []).allowed, false)

  const excepted = evaluateGate(specGate, facts, [
    { gate: 'spec-gate', reason: 'vendor review pending', approvedBy: 'lead', at: 1 },
  ])
  assert.equal(excepted.allowed, true)
  assert.deepEqual(excepted.deferred, ['spec-reviewed'])
})

test('all PASS advances the run', () => {
  const run = startRun(definition, 'r4', 'T-4', 0)
  const result = advanceRun(definition, gates, run, 'build', allPass, 1)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.run.currentStage, 'build')
})

test('validateCatalogue reports a dangling gate, a duplicate id and an empty gate', () => {
  const broken: WorkflowDefinition = {
    ...definition,
    stages: definition.stages.map((s) =>
      s.id === 'spec' ? { ...s, gate: 'specifcation-gate' } : s,
    ),
  }
  const problems = validateCatalogue([broken, broken], {
    ...gates,
    hollow: { id: 'hollow', description: '', facts: [] },
  })
  assert.ok(
    problems.some((p) => /specifcation-gate/.test(p)),
    problems.join('\n'),
  )
  assert.ok(problems.some((p) => /duplicate workflow id demo/.test(p)))
  assert.ok(problems.some((p) => /gate hollow declares no facts/.test(p)))
})

/** The nearest ancestor of the working directory that holds the gate catalogue. */
function repoRoot(): string {
  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'gates', 'gates.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir)
      throw new Error('repository root not found: run the tests inside the repository')
    dir = parent
  }
}

test('the shipped workflow and gate catalogues are valid', () => {
  const root = repoRoot()
  const gateParse = parseGates(JSON.parse(readFileSync(join(root, 'gates', 'gates.json'), 'utf8')))
  assert.equal(gateParse.ok, true, gateParse.ok ? '' : gateParse.error)
  if (!gateParse.ok) return

  const workflows: WorkflowDefinition[] = []
  for (const name of [
    'bug-fix',
    'feature-development',
    'hotfix',
    'incident-response',
    'pull-request',
    'refactoring',
    'regression',
    'release',
    'tdd',
  ]) {
    const parsed = parseWorkflow(
      JSON.parse(readFileSync(join(root, 'workflows', `${name}.json`), 'utf8')),
    )
    assert.equal(parsed.ok, true, `${name}: ${parsed.ok ? '' : parsed.error}`)
    if (parsed.ok) workflows.push(parsed.value)
  }
  assert.deepEqual(validateCatalogue(workflows, gateParse.value), [])
})
