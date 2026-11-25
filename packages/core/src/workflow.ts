/**
 * The workflow engine. Definitions are data; evaluation is pure. A stage advances only when its
 * gate's facts are all PASS, or a recorded exception covers the gap. Exceptions are visible,
 * so a deferral is never reported as a pass.
 */
import type { Verdict } from './policy'
import { isJsonObject } from './util'

export type FactValue = Verdict | 'DEFERRED'

export type GateDefinition = {
  id: string
  description: string
  facts: string[]
}

export type StageDefinition = {
  id: string
  name: string
  gate: string | null
  artifact: string | null
  next: string[]
}

export type WorkflowDefinition = {
  id: string
  description: string
  start: string
  stages: StageDefinition[]
}

export type Exception = {
  gate: string
  reason: string
  approvedBy: string
  at: number
}

export type GateEvaluation = {
  allowed: boolean
  missing: string[]
  failing: string[]
  deferred: string[]
}

export type RunStatus = 'active' | 'completed' | 'cancelled'

export type RunState = {
  id: string
  workflowId: string
  taskId: string
  currentStage: string
  status: RunStatus
  history: Array<{ stage: string; at: number; action: string }>
  exceptions: Exception[]
}

function stringsOf(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : null
}

/** Validates a workflow definition. Returns the first problem found. */
export function parseWorkflow(input: unknown): { ok: true; value: WorkflowDefinition } | { ok: false; error: string } {
  if (!isJsonObject(input)) return { ok: false, error: 'workflow must be an object' }
  const id = input['id']
  const description = input['description']
  const start = input['start']
  if (typeof id !== 'string' || typeof description !== 'string' || typeof start !== 'string') {
    return { ok: false, error: 'workflow needs string id, description and start' }
  }
  if (!Array.isArray(input['stages']) || input['stages'].length === 0) {
    return { ok: false, error: `workflow ${id} has no stages` }
  }
  const stages: StageDefinition[] = []
  for (const raw of input['stages']) {
    if (!isJsonObject(raw) || typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') {
      return { ok: false, error: `workflow ${id} has a malformed stage` }
    }
    const next = stringsOf(raw['next'])
    if (next === null) return { ok: false, error: `stage ${raw['id']} needs a next list` }
    const gate = raw['gate'] === null || raw['gate'] === undefined ? null : raw['gate']
    const artifact = raw['artifact'] === null || raw['artifact'] === undefined ? null : raw['artifact']
    if (gate !== null && typeof gate !== 'string') return { ok: false, error: `stage ${raw['id']} gate must be a string` }
    if (artifact !== null && typeof artifact !== 'string') {
      return { ok: false, error: `stage ${raw['id']} artifact must be a string` }
    }
    stages.push({ id: raw['id'], name: raw['name'], gate, artifact, next })
  }
  const ids = new Set(stages.map(stage => stage.id))
  if (!ids.has(start)) return { ok: false, error: `start stage ${start} is not defined` }
  for (const stage of stages) {
    for (const target of stage.next) {
      if (!ids.has(target)) return { ok: false, error: `stage ${stage.id} points at undefined ${target}` }
    }
  }
  return { ok: true, value: { id, description, start, stages } }
}

/** Validates the gate catalogue: each gate names the facts it needs. */
export function parseGates(input: unknown): { ok: true; value: Record<string, GateDefinition> } | { ok: false; error: string } {
  if (!isJsonObject(input)) return { ok: false, error: 'gates must be an object keyed by gate id' }
  const out: Record<string, GateDefinition> = {}
  for (const [id, raw] of Object.entries(input)) {
    if (!isJsonObject(raw) || typeof raw['description'] !== 'string') {
      return { ok: false, error: `gate ${id} needs a description` }
    }
    const facts = stringsOf(raw['facts'])
    if (facts === null || facts.length === 0) return { ok: false, error: `gate ${id} needs a non-empty facts list` }
    out[id] = { id, description: raw['description'], facts }
  }
  return { ok: true, value: out }
}

export function stageOf(definition: WorkflowDefinition, id: string): StageDefinition | undefined {
  return definition.stages.find(stage => stage.id === id)
}

/**
 * Evaluates a gate. A fact that is missing, UNKNOWN or STALE blocks the gate. A FAIL blocks it
 * too, and is reported separately. DEFERRED is allowed only with a recorded exception.
 */
export function evaluateGate(
  gate: GateDefinition,
  facts: Readonly<Record<string, FactValue>>,
  exceptions: readonly Exception[],
): GateEvaluation {
  const excepted = exceptions.some(item => item.gate === gate.id)
  const missing: string[] = []
  const failing: string[] = []
  const deferred: string[] = []
  for (const fact of gate.facts) {
    const value = facts[fact] ?? 'UNKNOWN'
    if (value === 'PASS') continue
    if (value === 'FAIL') failing.push(fact)
    else if (value === 'DEFERRED' && excepted) deferred.push(fact)
    else missing.push(fact)
  }
  return {
    allowed: missing.length === 0 && failing.length === 0,
    missing,
    failing,
    deferred,
  }
}

export function startRun(definition: WorkflowDefinition, runId: string, taskId: string, at: number): RunState {
  return {
    id: runId,
    workflowId: definition.id,
    taskId,
    currentStage: definition.start,
    status: 'active',
    history: [{ stage: definition.start, at, action: 'started' }],
    exceptions: [],
  }
}

/** Advances to `target` only along a declared transition, and only when its gate allows it. */
export function advanceRun(
  definition: WorkflowDefinition,
  gates: Readonly<Record<string, GateDefinition>>,
  run: RunState,
  target: string,
  facts: Readonly<Record<string, FactValue>>,
  at: number,
): { ok: true; run: RunState; evaluation: GateEvaluation | null } | { ok: false; reason: string; evaluation: GateEvaluation | null } {
  const current = stageOf(definition, run.currentStage)
  if (run.status !== 'active' || current === undefined) {
    return { ok: false, reason: `run is ${run.status}`, evaluation: null }
  }
  if (!current.next.includes(target)) {
    return { ok: false, reason: `${current.id} cannot move to ${target}`, evaluation: null }
  }
  const targetStage = stageOf(definition, target)
  if (targetStage === undefined) return { ok: false, reason: `${target} is not a stage`, evaluation: null }

  // The gate of the stage being left is what must be satisfied before leaving it.
  const gateId = current.gate
  const evaluation = gateId === null ? null : evaluateGate(gates[gateId] ?? { id: gateId, description: '', facts: [] }, facts, run.exceptions)
  if (evaluation !== null && !evaluation.allowed) {
    return { ok: false, reason: `${current.id} gate is not satisfied`, evaluation }
  }
  const terminal = targetStage.next.length === 0
  const nextRun: RunState = {
    ...run,
    currentStage: target,
    status: terminal ? 'completed' : 'active',
    history: [...run.history, { stage: target, at, action: `advanced from ${current.id}` }],
  }
  return { ok: true, run: nextRun, evaluation }
}
