// verify: verification-driven escalation engine mod.
//
// The engine itself is pure and runtime-agnostic (packages/core/src/
// verification.ts). This adapter exposes it as Claude Code commands and
// supplies the two host effects the engine needs:
//   - execute(route): ask the host to run the task (via $.tool.call) at the
//     given model + effort. The host rewrites the spawn with the route.
//   - verify(output): run the built-in deterministic checks against the output.
//
//   /verify-run <task>   classify -> route -> execute -> verify -> escalate
//   /verify-status       session summary of every run's outcome
//
// This is the architectural piece the reference repo was missing: a loop that
// runs AFTER a routed task completes, not just before it starts.

import type { Register } from 'claude-code'
import {
  verifyEngine,
  type ClassifyInput,
  type EscalationPolicy,
  type RunOutcome,
  type RoutingPolicy,
  type VerificationResult,
} from '@agentic-mods/core'
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

export const register: Register = (on) => {
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

    // 1. Classify complexity/risk and pick the initial route.
    const classifyInput: ClassifyInput = { task, agentType: 'main' }
    const classification = heuristicClassify(classifyInput)
    const initial: RoutingPolicy = pickInitialRoute(classification.effort, DEFAULT_POLICY)

    // 2. Execute + verify + escalate via the pure engine.
    const outcome = await verifyEngine.run({
      initial,
      policy: DEFAULT_POLICY,
      classifyFailure: (f: VerificationResult) => heuristicClassifyFailure(f),
      execute: async (route: RoutingPolicy) => {
        // Ask the host to run the task at the chosen model + effort. The host
        // rewrites the agent.spawn; we just capture the textual output.
        try {
          const res = await $.tool.call({ tool: 'Bash', command: task, model: route.model, effort: route.effort })
          return typeof res === 'string' ? res : (res as { result?: string; text?: string })?.result ?? (res as { text?: string })?.text ?? JSON.stringify(res)
        } catch (err) {
          // Surface the error so the engine treats it as a transient failure.
          throw err
        }
      },
      verify: async (output: unknown) => {
        // Built-in check: the output must be non-empty and contain the task
        // keyword, as a deterministic proxy for "did the run do anything?".
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

/** Map an effort level to the first route in the policy at that effort. */
function pickInitialRoute(effort: RoutingPolicy['effort'], policy: EscalationPolicy): RoutingPolicy {
  const match = policy.fallbackRoutes.find((r) => r.effort === effort)
  return match ?? policy.fallbackRoutes[0] ?? { model: 'claude-sonnet-4.5', effort: 'medium' }
}
