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
  /** Set when the gate itself cannot be satisfied, for example a gate with no facts. */
  invalid?: string
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
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : null
}

/** Validates a workflow definition. Returns the first problem found. */
export function parseWorkflow(
  input: unknown,
): { ok: true; value: WorkflowDefinition } | { ok: false; error: string } {
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
    const artifact =
      raw['artifact'] === null || raw['artifact'] === undefined ? null : raw['artifact']
    if (gate !== null && typeof gate !== 'string')
      return { ok: false, error: `stage ${raw['id']} gate must be a string` }
    if (artifact !== null && typeof artifact !== 'string') {
      return { ok: false, error: `stage ${raw['id']} artifact must be a string` }
    }
    stages.push({ id: raw['id'], name: raw['name'], gate, artifact, next })
  }
  const ids = new Set(stages.map((stage) => stage.id))
  if (!ids.has(start)) return { ok: false, error: `start stage ${start} is not defined` }
  for (const stage of stages) {
    for (const target of stage.next) {
      if (!ids.has(target))
        return { ok: false, error: `stage ${stage.id} points at undefined ${target}` }
    }
  }
  return { ok: true, value: { id, description, start, stages } }
}

/** Validates the gate catalogue: each gate names the facts it needs. */
export function parseGates(
  input: unknown,
): { ok: true; value: Record<string, GateDefinition> } | { ok: false; error: string } {
  if (!isJsonObject(input)) return { ok: false, error: 'gates must be an object keyed by gate id' }
  const out: Record<string, GateDefinition> = {}
  for (const [id, raw] of Object.entries(input)) {
    if (!isJsonObject(raw) || typeof raw['description'] !== 'string') {
      return { ok: false, error: `gate ${id} needs a description` }
    }
    const facts = stringsOf(raw['facts'])
    if (facts === null || facts.length === 0)
      return { ok: false, error: `gate ${id} needs a non-empty facts list` }
    out[id] = { id, description: raw['description'], facts }
  }
  return { ok: true, value: out }
}

export function stageOf(definition: WorkflowDefinition, id: string): StageDefinition | undefined {
  return definition.stages.find((stage) => stage.id === id)
}

/**
 * Looks a gate up by id. Only the catalogue's own keys count: a plain object lookup would return
 * `Object.prototype` members for ids such as `constructor` or `toString`, and treat them as gates.
 */
export function gateOf(
  gates: Readonly<Record<string, GateDefinition>>,
  id: string,
): GateDefinition | undefined {
  return Object.hasOwn(gates, id) ? gates[id] : undefined
}

/**
 * Evaluates a gate. A fact that is missing, UNKNOWN or STALE blocks the gate. A FAIL blocks it
 * too, and is reported separately. DEFERRED is allowed only with a recorded exception.
 *
 * A gate with no facts is never allowed. An empty fact list would otherwise be vacuously true,
 * which is how a misdeclared gate used to pass.
 */
export function evaluateGate(
  gate: GateDefinition,
  facts: Readonly<Record<string, FactValue>>,
  exceptions: readonly Exception[],
): GateEvaluation {
  if (gate.facts.length === 0) {
    return {
      allowed: false,
      missing: [],
      failing: [],
      deferred: [],
      invalid: `gate ${gate.id} declares no facts and cannot be satisfied`,
    }
  }
  const excepted = exceptions.some((item) => item.gate === gate.id)
  const missing: string[] = []
  const failing: string[] = []
  const deferred: string[] = []
  for (const fact of gate.facts) {
    const value: FactValue = Object.hasOwn(facts, fact) ? (facts[fact] ?? 'UNKNOWN') : 'UNKNOWN'
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

/**
 * Checks a workflow catalogue against its gate catalogue and returns every problem found, not just
 * the first. The workflow engine must not start while this list is non-empty: a stage whose gate is
 * undefined would otherwise have no check at all.
 */
export function validateCatalogue(
  workflows: readonly WorkflowDefinition[],
  gates: Readonly<Record<string, GateDefinition>>,
): string[] {
  const problems: string[] = []
  const workflowIds = new Set<string>()
  for (const workflow of workflows) {
    if (workflowIds.has(workflow.id)) problems.push(`duplicate workflow id ${workflow.id}`)
    workflowIds.add(workflow.id)
    const stageIds = new Set<string>()
    for (const stage of workflow.stages) {
      if (stageIds.has(stage.id)) {
        problems.push(`workflow ${workflow.id} defines stage ${stage.id} more than once`)
      }
      stageIds.add(stage.id)
      if (stage.gate !== null && gateOf(gates, stage.gate) === undefined) {
        problems.push(
          `workflow ${workflow.id} stage ${stage.id} references gate ${stage.gate}, which is not in the gate catalogue`,
        )
      }
    }
  }
  for (const [id, gate] of Object.entries(gates)) {
    if (gate.facts.length === 0) problems.push(`gate ${id} declares no facts`)
  }
  return problems
}

export function startRun(
  definition: WorkflowDefinition,
  runId: string,
  taskId: string,
  at: number,
): RunState {
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
):
  | { ok: true; run: RunState; evaluation: GateEvaluation | null }
  | { ok: false; reason: string; evaluation: GateEvaluation | null } {
  const current = stageOf(definition, run.currentStage)
  if (run.status !== 'active' || current === undefined) {
    return { ok: false, reason: `run is ${run.status}`, evaluation: null }
  }
  if (!current.next.includes(target)) {
    return { ok: false, reason: `${current.id} cannot move to ${target}`, evaluation: null }
  }
  const targetStage = stageOf(definition, target)
  if (targetStage === undefined)
    return { ok: false, reason: `${target} is not a stage`, evaluation: null }

  // The gate of the stage being left is what must be satisfied before leaving it. A gate id that is
  // not in the catalogue blocks the move: it must never be replaced by an empty, passing gate.
  let evaluation: GateEvaluation | null = null
  if (current.gate !== null) {
    const gate = gateOf(gates, current.gate)
    if (gate === undefined) {
      return {
        ok: false,
        reason: `${current.id} references gate ${current.gate}, which is not in the gate catalogue`,
        evaluation: null,
      }
    }
    evaluation = evaluateGate(gate, facts, run.exceptions)
  }
  if (evaluation !== null && !evaluation.allowed) {
    const reason = evaluation.invalid ?? `${current.id} gate is not satisfied`
    return { ok: false, reason, evaluation }
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
