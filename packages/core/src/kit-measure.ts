// Measures one run of the kit's orchestration loop (`kit feature|fix <id> run --json`).
//
// Inputs are the kit's OrchestrationReport and the stored execution records of the run. The summary is
// what the measurement harness reports: did the run converge, how many attempts each phase took, how
// many tool calls were denied, and what the run cost in tokens and time. Fields the kit does not report
// come back as null, never as zero.

export type KitRunMetrics = {
  readonly featureId: string
  readonly status: string
  /** True only when the kit reported the run completed, which means its final verification passed. */
  readonly converged: boolean
  readonly tasksCompleted: number
  readonly tasksTotal: number
  /** Attempts per "TASK phase" key, for example "TASK-001 red": a retry shows up as a higher count. */
  readonly attempts: Readonly<Record<string, number>>
  readonly executions: number
  /** tool.result events with status "denied", across every stored execution. */
  readonly denials: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly durationMs: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Usage is on the record (`usage`) or on its final result (`result.usage`), wherever the kit stored it. */
function usageOf(record: Record<string, unknown>): { input: number | null; output: number | null } {
  const direct = isRecord(record['usage']) ? record['usage'] : null
  const nested =
    isRecord(record['result']) && isRecord(record['result']['usage'])
      ? record['result']['usage']
      : null
  const usage = direct ?? nested
  if (usage === null) return { input: null, output: null }
  return {
    input: numberOrNull(usage['inputTokens']),
    output: numberOrNull(usage['outputTokens']),
  }
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0)
}

/**
 * Summarises one orchestration run. Throws when the report is not the kit's report shape: a measurement
 * built on a misread report would be worse than no measurement.
 */
export function summarizeKitRun(report: unknown, records: readonly unknown[]): KitRunMetrics {
  if (!isRecord(report)) throw new Error('kit run report is not an object')
  const featureId = report['featureId']
  const status = report['status']
  const tasks = report['tasks']
  const executions = report['executions']
  if (typeof featureId !== 'string' || typeof status !== 'string') {
    throw new Error('kit run report has no featureId or status')
  }
  if (!Array.isArray(tasks) || !Array.isArray(executions)) {
    throw new Error('kit run report has no tasks or executions list')
  }

  const attempts: Record<string, number> = {}
  for (const link of executions) {
    if (
      !isRecord(link) ||
      typeof link['taskId'] !== 'string' ||
      typeof link['phase'] !== 'string'
    ) {
      throw new Error('kit run report has an execution without a task or phase')
    }
    const key = `${link['taskId']} ${link['phase']}`
    attempts[key] = (attempts[key] ?? 0) + 1
  }

  let denials = 0
  const usages: { input: number | null; output: number | null }[] = []
  for (const raw of records) {
    if (!isRecord(raw)) continue
    usages.push(usageOf(raw))
    const events = Array.isArray(raw['events']) ? raw['events'] : []
    for (const event of events) {
      if (isRecord(event) && event['type'] === 'tool.result' && event['status'] === 'denied') {
        denials += 1
      }
    }
  }

  const tasksCompleted = tasks.filter((task) => isRecord(task) && task['completed'] === true).length
  const startedAt = typeof report['startedAt'] === 'string' ? Date.parse(report['startedAt']) : NaN
  const completedAt =
    typeof report['completedAt'] === 'string' ? Date.parse(report['completedAt']) : NaN
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(completedAt) ? completedAt - startedAt : null

  return {
    featureId,
    status,
    converged: status === 'completed',
    tasksCompleted,
    tasksTotal: tasks.length,
    attempts,
    executions: executions.length,
    denials,
    inputTokens: sumOrNull(usages.map((usage) => usage.input)),
    outputTokens: sumOrNull(usages.map((usage) => usage.output)),
    durationMs,
  }
}

/** A one-row-per-task markdown summary for the measurement log. */
export function renderKitRunMetrics(metrics: KitRunMetrics): string {
  const show = (value: number | null, unit = ''): string =>
    value === null ? 'not reported' : `${value}${unit}`
  const attemptLines = Object.entries(metrics.attempts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `- ${key}: ${count} attempt${count === 1 ? '' : 's'}`)
  return [
    `### ${metrics.featureId}: ${metrics.converged ? 'converged' : `did not converge (${metrics.status})`}`,
    '',
    `- tasks completed: ${metrics.tasksCompleted} of ${metrics.tasksTotal}`,
    `- executions: ${metrics.executions}`,
    `- denied tool calls: ${metrics.denials}`,
    `- uncached input / output tokens: ${show(metrics.inputTokens)} / ${show(metrics.outputTokens)}`,
    `- duration: ${show(metrics.durationMs === null ? null : Math.round(metrics.durationMs / 1000), ' s')}`,
    ...attemptLines,
  ].join('\n')
}
