// Verification + escalation contracts for the agentic-mods SDK.
//
// This is the architectural piece the reference repository (claude-code-mods)
// was explicitly missing: a verification-driven escalation loop that runs
// AFTER a routed task completes, not just BEFORE it starts (which is all
// Switchboard's agent.spawn routing does).
//
// The pipeline is runtime-agnostic:
//
//   Task -> classify complexity/risk -> select RoutingPolicy
//        -> execute -> verify with deterministic checks
//          PASS -> complete
//          FAIL -> classify failure -> escalate -> re-execute -> verify again
//
// Each step is a pure function over data; the host adapter (Claude Code,
// Nexum, ...) only supplies the imperative "execute" and "verify" effects.

import type { RoutingPolicy } from './routing'

/** Inputs to complexity/risk classification. */
export interface ClassifyInput {
  /** The task description (e.g. subagent prompt). */
  readonly task: string
  /** Role of the agent that would run it. */
  readonly agentType: string
  /** Extra host-provided signals, e.g. "touches prod", "irreversible". */
  readonly signals?: Readonly<Record<string, string | number | boolean>>
}

/** A classified task: how complex, how risky, suggested effort. */
export interface ClassifyResult {
  /** 0 (trivial) .. 1 (very complex). */
  readonly complexity: number
  /** 0 (safe) .. 1 (high-risk / irreversible). */
  readonly risk: number
  /** The effort a first attempt should use. */
  readonly effort: RoutingPolicy['effort']
  /** Human-readable rationale, surfaced in traces. */
  readonly rationale: string
}

/** A deterministic check run against the execution output. */
export interface VerificationCheck {
  readonly name: string
  /** Returns true when the check passes; the evidence is shown on failure. */
  run(output: unknown): Promise<VerificationCheckResult> | VerificationCheckResult
}

export interface VerificationCheckResult {
  readonly passed: boolean
  /** Why it failed (empty when passed). */
  readonly reason: string
  /** Supporting data (file diffs, test counts, stdout). */
  readonly evidence?: string[]
}

/** Outcome of verifying one execution attempt. */
export interface VerificationResult {
  readonly passed: boolean
  readonly failures: string[]
  readonly evidence: string[]
}

/** Categories of failure; drives whether escalation retries or gives up. */
export type FailureCategory =
  | 'transient' // network/flaky; worth retrying on the same route
  | 'deterministic' // logic bug; retrying identically is pointless
  | 'route-mismatch' // wrong model/effort; escalate route
  | 'fatal' // unrecoverable; stop immediately

/** A classified failure, ready to drive escalation. */
export interface ClassifiedFailure {
  readonly category: FailureCategory
  readonly detail: string
}

/** How the engine may escalate after a failure. */
export interface EscalationPolicy {
  /** Maximum total attempts (including the first). */
  readonly maxAttempts: number
  /** Failure categories the engine will retry at all. Others stop. */
  readonly retryableFailures: readonly FailureCategory[]
  /** Ordered routes to climb on a `route-mismatch` failure. */
  readonly fallbackRoutes: readonly RoutingPolicy[]
}

/** A single attempt's record, kept in the run trace. */
export interface AttemptRecord {
  readonly attempt: number
  readonly route: RoutingPolicy
  readonly verification: VerificationResult
  readonly failure?: ClassifiedFailure
}

/** Final outcome of a verified-escalation run. */
export interface RunOutcome {
  readonly status: 'completed' | 'escalated' | 'exhausted' | 'aborted'
  readonly attempts: readonly AttemptRecord[]
  /** The route that finally passed, if any. */
  readonly finalRoute?: RoutingPolicy
}

/**
 * Run the verify -> escalate loop against pure inputs and two host-supplied
 * effects: `execute(route)` runs the task, `verify(output)` checks the result.
 *
 * The loop:
 *   1. execute on the initial route
 *   2. verify the output
 *   3. pass -> return completed
 *   4. fail -> classify; if not retryable -> aborted
 *   5. route-mismatch -> climb to next fallback route (or abort if exhausted)
 *   6. transient -> retry same route
 *   7. deterministic -> abort (retrying identically is pointless)
 *   8. stop at maxAttempts -> exhausted
 */
export interface VerifyEngine {
  run(input: {
    initial: RoutingPolicy
    classifyFailure: (failure: VerificationResult) => ClassifiedFailure
    execute: (route: RoutingPolicy) => Promise<unknown>
    verify: (output: unknown) => Promise<VerificationResult>
    policy: EscalationPolicy
  }): Promise<RunOutcome>
}

/**
 * Pure reference implementation of the VerifyEngine contract. Hosts pass the
 * two effects; this function owns the loop, the trace and the policy gates.
 * Exported so adapters and tests share one definition of "escalation".
 */
export const verifyEngine: VerifyEngine = {
  async run({ initial, classifyFailure, execute, verify, policy }) {
    const attempts: AttemptRecord[] = []
    let route = initial

    for (let attemptNo = 1; attemptNo <= policy.maxAttempts; attemptNo += 1) {
      let output: unknown
      try {
        output = await execute(route)
      } catch (err) {
        // Execution itself threw: treat as a transient failure so a retry on a
        // fallback route can recover; record the message as evidence.
        const failure: ClassifiedFailure = { category: 'transient', detail: messageOf(err) }
        attempts.push({
          attempt: attemptNo,
          route,
          verification: { passed: false, failures: [failure.detail], evidence: [] },
          failure,
        })
        const outcome = decideEscalation(failure, route, policy, attempts.length)
        if (outcome.kind === 'abort') return finalize('aborted', attempts)
        if (outcome.kind === 'exhausted') return finalize('exhausted', attempts)
        if (outcome.kind === 'escalate' && outcome.nextRoute) route = outcome.nextRoute
        continue
      }

      const result = await verify(output)
      if (result.passed) {
        attempts.push({ attempt: attemptNo, route, verification: result })
        return { status: 'completed', attempts, finalRoute: route }
      }

      const failure = classifyFailure(result)
      attempts.push({ attempt: attemptNo, route, verification: result, failure })

      const outcome = decideEscalation(failure, route, policy, attempts.length)
      if (outcome.kind === 'abort') return finalize('aborted', attempts)
      if (outcome.kind === 'exhausted') return finalize('exhausted', attempts)
      if (outcome.kind === 'escalate' && outcome.nextRoute) route = outcome.nextRoute
    }
    return finalize('exhausted', attempts)
  },
}

type EscalationDecision =
  | { kind: 'retry' }
  | { kind: 'escalate'; nextRoute: RoutingPolicy }
  | { kind: 'abort' }
  | { kind: 'exhausted' }

function decideEscalation(
  failure: ClassifiedFailure,
  currentRoute: RoutingPolicy,
  policy: EscalationPolicy,
  attemptsSoFar: number,
): EscalationDecision {
  if (!policy.retryableFailures.includes(failure.category)) return { kind: 'abort' }
  if (attemptsSoFar >= policy.maxAttempts) return { kind: 'exhausted' }

  if (failure.category === 'route-mismatch') {
    const idx = policy.fallbackRoutes.findIndex((r) => r.model === currentRoute.model)
    const next = policy.fallbackRoutes[idx + 1]
    if (!next) return { kind: 'exhausted' }
    return { kind: 'escalate', nextRoute: next }
  }
  // transient: retry on the same route
  return { kind: 'retry' }
}

function finalize(status: 'aborted' | 'exhausted', attempts: AttemptRecord[]): RunOutcome {
  return { status, attempts }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'execution failed'
}

/** A trivial classifier: tasks are medium-complexity, low-risk, medium effort. */
export function defaultClassify(input: ClassifyInput): ClassifyResult {
  void input
  return { complexity: 0.5, risk: 0.2, effort: 'medium', rationale: 'default heuristic' }
}

/** A trivial failure classifier: anything that failed is treated as route-mismatch. */
export function defaultClassifyFailure(f: VerificationResult): ClassifiedFailure {
  // If the verification produced no failures array (shouldn't happen, but be
  // defensive), treat it as deterministic so we don't loop forever.
  if (f.failures.length === 0)
    return { category: 'deterministic', detail: 'verification failed without a reason' }
  return { category: 'route-mismatch', detail: f.failures[0] ?? 'unspecified' }
}
