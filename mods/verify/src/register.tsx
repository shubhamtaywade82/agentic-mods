import type { On } from 'claude-code'
import {
  verifyEngine,
  type ClassifyInput,
  type EscalationPolicy,
  type RunOutcome,
  type VerificationResult,
} from './lib/verification'
import type { RoutingPolicy } from './lib/routing'
import {
  DEFAULT_POLICY,
  containsCheck,
  heuristicClassify,
  heuristicClassifyFailure,
  nonEmptyCheck,
  renderOutcome,
  renderStatus,
  runChecks,
} from './lib/policy'

const runs: RunOutcome[] = []

function strField(e: unknown, key: string): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

function pickInitialRoute(effort: RoutingPolicy['effort'], policy: EscalationPolicy): RoutingPolicy {
  const match = policy.fallbackRoutes.find((r) => r.effort === effort)
  return match ?? policy.fallbackRoutes[0] ?? { model: 'claude-3-7-sonnet', effort: 'medium' }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'verify-run',
      description: 'Run a task through the verify-escalate engine: classify, route, execute, verify, escalate',
    })
    await $.command.register({
      name: 'verify-status',
      description: 'Show the outcomes of every verify-run this session',
    })
    runs.length = 0
    return next(e)
  })

  on('command.run', { command: 'verify-run' }, async ($, e) => {
    const task = strField(e, 'args') ?? ''
    if (task.length === 0) return { text: 'usage: /verify-run <task description>' }

    const classifyInput: ClassifyInput = { task, agentType: 'main' }
    const classification = heuristicClassify(classifyInput)
    const initial: RoutingPolicy = pickInitialRoute(classification.effort, DEFAULT_POLICY)

    const outcome = await verifyEngine.run({
      initial,
      policy: DEFAULT_POLICY,
      classifyFailure: (f: VerificationResult) => heuristicClassifyFailure(f),
      execute: async () => {
        const res = await $.process.run(['bash', '-c', task])
        return res.stdout || res.stderr
      },
      verify: async (output: unknown) => {
        const keyword = task.split(' ')[0] ?? 'task'
        return runChecks(output, [nonEmptyCheck, containsCheck(keyword)])
      },
    })
    runs.push(outcome)
    return { text: renderOutcome(outcome) }
  })

  on('command.run', { command: 'verify-status' }, async () => {
    return { text: renderStatus(runs) }
  })
}
