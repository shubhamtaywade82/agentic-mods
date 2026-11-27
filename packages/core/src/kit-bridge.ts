// Bridge to the Agentic SDLC Kit's host-driven protocol (`kit next --json`, ADR-0021 of the kit).
//
// The kit owns the run state, the TDD phases and the evidence. This module only (1) parses the kit's
// versioned NextAction payload, strictly, and (2) turns it into the argv of the next phase command.
// It never runs `nextInvocation` as text: that string is for humans, and splitting it would reintroduce
// the word-splitting this project removed from verify. The argv is built from the structured fields.
//
// Every value that reaches argv is checked against ID_PATTERN first. A payload that does not match
// the schema is refused, not repaired.

import { decideProcess } from './command-policy'

export const KIT_SCHEMA_VERSION = 1

/** Feature and task ids: one token, no separators, no shell metacharacters. */
export const KIT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

const STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'failed'] as const
const REQUIRED_ACTIONS = [
  'feature.start',
  'task.red',
  'task.green',
  'task.refactor',
  'feature.verify',
  'run.completed',
] as const
const PHASES = ['red', 'green', 'refactor'] as const

export type KitStatus = (typeof STATUSES)[number]
export type KitRequiredAction = (typeof REQUIRED_ACTIONS)[number]
export type KitPhase = (typeof PHASES)[number]

export type KitNextAction = {
  readonly schemaVersion: 1
  readonly featureId: string
  readonly status: KitStatus
  readonly taskId?: string
  readonly phase?: KitPhase
  readonly requiredAction: KitRequiredAction
  readonly verificationCommand: readonly string[]
  readonly nextInvocation: string
  readonly blockingQuestions: readonly string[]
  readonly advisoryLessons: readonly { readonly summary: string }[]
  readonly constraints: { readonly timeoutMs: number; readonly maxOutputBytes: number }
}

/** The kit command family a run belongs to. `feature` is TDD for a feature, `fix` for a defect. */
export type KitMode = 'feature' | 'fix'

/** The workflow ids this bridge drives. Every other workflow stays on the legacy engine. */
export const KIT_BACKED_WORKFLOWS: Readonly<Record<string, KitMode>> = {
  'feature-development': 'feature',
  'bug-fix': 'fix',
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : null
}

/** Parses and validates a `kit next --json` payload. Any deviation from schema v1 is an error. */
export function parseKitNextAction(text: string): ParseResult<KitNextAction> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'kit next did not print JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'kit next payload is not an object' }
  if (raw['schemaVersion'] !== KIT_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported kit schemaVersion ${String(raw['schemaVersion'])}` }
  }

  const featureId = raw['featureId']
  if (typeof featureId !== 'string' || !KIT_ID_PATTERN.test(featureId)) {
    return { ok: false, error: 'kit featureId is missing or not a plain identifier' }
  }
  const status = raw['status']
  if (!(STATUSES as readonly unknown[]).includes(status)) {
    return { ok: false, error: `kit status ${String(status)} is not recognised` }
  }
  const requiredAction = raw['requiredAction']
  if (!(REQUIRED_ACTIONS as readonly unknown[]).includes(requiredAction)) {
    return { ok: false, error: `kit requiredAction ${String(requiredAction)} is not recognised` }
  }

  const taskId = raw['taskId']
  const phase = raw['phase']
  const isTaskAction = String(requiredAction).startsWith('task.')
  if (isTaskAction) {
    if (typeof taskId !== 'string' || !KIT_ID_PATTERN.test(taskId)) {
      return { ok: false, error: `${String(requiredAction)} needs a plain taskId` }
    }
    if (!(PHASES as readonly unknown[]).includes(phase)) {
      return { ok: false, error: `${String(requiredAction)} needs a red, green or refactor phase` }
    }
    if (requiredAction !== `task.${String(phase)}`) {
      return { ok: false, error: `${String(requiredAction)} does not match phase ${String(phase)}` }
    }
  } else if (taskId !== undefined || phase !== undefined) {
    return { ok: false, error: `${String(requiredAction)} is run-level and must not name a task` }
  }

  const verificationCommand = stringArray(raw['verificationCommand'])
  if (verificationCommand === null)
    return { ok: false, error: 'kit verificationCommand is not a string array' }
  const nextInvocation = raw['nextInvocation']
  if (typeof nextInvocation !== 'string' || nextInvocation.length === 0) {
    return { ok: false, error: 'kit nextInvocation is missing' }
  }
  const blockingQuestions = stringArray(raw['blockingQuestions'])
  if (blockingQuestions === null)
    return { ok: false, error: 'kit blockingQuestions is not a string array' }

  const lessons = raw['advisoryLessons']
  if (!Array.isArray(lessons)) return { ok: false, error: 'kit advisoryLessons is not an array' }
  const advisoryLessons: { summary: string }[] = []
  for (const item of lessons) {
    if (!isRecord(item) || item['advisory'] !== true || typeof item['summary'] !== 'string') {
      return { ok: false, error: 'kit advisoryLessons entry is not an advisory lesson' }
    }
    advisoryLessons.push({ summary: item['summary'] })
  }

  const constraints = raw['constraints']
  if (
    !isRecord(constraints) ||
    !Number.isInteger(constraints['timeoutMs']) ||
    (constraints['timeoutMs'] as number) <= 0 ||
    !Number.isInteger(constraints['maxOutputBytes']) ||
    (constraints['maxOutputBytes'] as number) <= 0
  ) {
    return { ok: false, error: 'kit constraints are missing or not positive integers' }
  }

  const value: KitNextAction = {
    schemaVersion: KIT_SCHEMA_VERSION,
    featureId,
    status: status as KitStatus,
    ...(isTaskAction ? { taskId: taskId as string, phase: phase as KitPhase } : {}),
    requiredAction: requiredAction as KitRequiredAction,
    verificationCommand,
    nextInvocation,
    blockingQuestions,
    advisoryLessons,
    constraints: {
      timeoutMs: constraints['timeoutMs'] as number,
      maxOutputBytes: constraints['maxOutputBytes'] as number,
    },
  }
  return { ok: true, value }
}

/** The phase command the kit expects next, as argv. Null when no command is due (run finished). */
export function kitPhaseArgv(
  mode: KitMode,
  featureId: string,
  action: KitNextAction,
): readonly string[] | null {
  if (!KIT_ID_PATTERN.test(featureId)) return null
  if (action.featureId !== featureId) return null
  switch (action.requiredAction) {
    case 'run.completed':
      return null
    case 'feature.start':
      return ['kit', mode, featureId, 'start']
    case 'feature.verify':
      return ['kit', mode, featureId, 'verify']
    case 'task.red':
    case 'task.green':
    case 'task.refactor': {
      const { taskId, phase } = action
      if (taskId === undefined || phase === undefined || !KIT_ID_PATTERN.test(taskId)) return null
      return ['kit', mode, featureId, phase, taskId]
    }
  }
}

/**
 * The argv that starts the kit's own orchestration loop for a run (`kit <mode> <id> run`, ADR-0019 Mode 1).
 * The kit drives an agent through its TDD state machine and its evidence gate. It runs the plan's
 * verification commands itself, so the caller must run the plan check first.
 */
export function kitOrchestrationArgv(mode: KitMode, featureId: string): readonly string[] | null {
  if (!KIT_ID_PATTERN.test(featureId)) return null
  return ['kit', mode, featureId, 'run']
}

/** True for the phases that execute the plan's verification commands. */
export function executesVerification(action: KitNextAction): boolean {
  return action.requiredAction !== 'feature.start' && action.requiredAction !== 'run.completed'
}

/**
 * Checks every task's verification command in a plan.json against the process policy. The kit runs
 * these commands itself, outside the engine's process hook, so the bridge checks them first. A task
 * without a verification command is reported, not skipped.
 */
export function deniedPlanCommands(planText: string): ParseResult<readonly string[]> {
  let plan: unknown
  try {
    plan = JSON.parse(planText)
  } catch {
    return {
      ok: false,
      error: 'plan.json is not valid JSON, so its verification commands cannot be checked',
    }
  }
  if (!isRecord(plan) || !Array.isArray(plan['tasks'])) {
    return {
      ok: false,
      error: 'plan.json has no tasks list, so its verification commands cannot be checked',
    }
  }
  const problems: string[] = []
  for (const task of plan['tasks']) {
    if (!isRecord(task) || typeof task['id'] !== 'string') {
      return { ok: false, error: 'plan.json has a task without an id' }
    }
    const verification = task['verification']
    const command = isRecord(verification) ? stringArray(verification['command']) : null
    if (command === null) {
      problems.push(`${task['id']}: no verification command`)
      continue
    }
    const decision = decideProcess(command)
    if (decision.kind !== 'allow') problems.push(`${task['id']}: ${decision.reason}`)
  }
  return { ok: true, value: problems }
}

/** Parses the output of `kit --version`. Null when the output carries no version. */
export function parseKitVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output)
  return match?.[1] ?? null
}

/** The human view of a kit action: what the kit is waiting for, and what it will check next. */
export function renderKitAction(action: KitNextAction, mode: KitMode): string {
  const where =
    action.taskId !== undefined && action.phase !== undefined
      ? `${action.taskId} ${action.phase}`
      : action.requiredAction
  const lines = [`${mode} run ${action.featureId} (${action.status}): ${where}`]
  if (action.requiredAction !== 'run.completed') lines.push(`Next: ${action.nextInvocation}`)
  if (action.verificationCommand.length > 0) {
    lines.push(`Checks with: ${action.verificationCommand.join(' ')}`)
  }
  for (const question of action.blockingQuestions) lines.push(`Waiting on a human: ${question}`)
  return lines.join('\n')
}
