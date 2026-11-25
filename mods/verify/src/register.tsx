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
  heuristicClassify,
  heuristicClassifyFailure,
  predicateCheck,
  renderOutcome,
  renderStatus,
  runChecks,
} from './lib/policy'

const runs: RunOutcome[] = []

interface CommandRun {
  exitCode: number
  output: string
}

// The failure text is what heuristicClassifyFailure reads, so a "timed out" in stderr retries.
const exitZeroCheck = predicateCheck(
  'exit-code-0',
  (output) => (output as CommandRun).exitCode === 0,
  'command exited non-zero',
)

function failureDetail(run: CommandRun): string {
  return `exit ${run.exitCode}: ${run.output.trim().slice(-200)}`
}

function strField(e: unknown, key: string): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

function pickInitialRoute(
  effort: RoutingPolicy['effort'],
  policy: EscalationPolicy,
): RoutingPolicy {
  const match = policy.fallbackRoutes.find((r) => r.effort === effort)
  return match ?? policy.fallbackRoutes[0] ?? { model: 'claude-3-7-sonnet', effort: 'medium' }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'verify-run',
      description:
        'Run a command and verify it exits 0, retrying transient failures: /verify-run <command> [args...]',
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
    if (task.trim().length === 0) return { text: 'usage: /verify-run <command> [args...]' }

    const classifyInput: ClassifyInput = { task, agentType: 'main' }
    const classification = heuristicClassify(classifyInput)
    const initial: RoutingPolicy = pickInitialRoute(classification.effort, DEFAULT_POLICY)

    const outcome = await verifyEngine.run({
      initial,
      policy: DEFAULT_POLICY,
      classifyFailure: (f: VerificationResult) => heuristicClassifyFailure(f),
      // Split into argv and run without a shell, so the task text cannot chain extra commands.
      execute: async (): Promise<CommandRun> => {
        const argv = task.split(/\s+/).filter((word) => word.length > 0)
        const res = await $.process.run(argv)
        return { exitCode: res.exitCode ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` }
      },
      verify: async (output: unknown) => {
        const result = await runChecks(output, [exitZeroCheck])
        if (result.passed) return result
        return { ...result, failures: [failureDetail(output as CommandRun)] }
      },
    })
    runs.push(outcome)
    return { text: renderOutcome(outcome) }
  })

  on('command.run', { command: 'verify-status' }, async () => {
    return { text: renderStatus(runs) }
  })
}
