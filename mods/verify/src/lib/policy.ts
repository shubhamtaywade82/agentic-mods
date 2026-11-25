// Concrete policies + classifiers + built-in checks for the verify mod.
//
// The escalation engine itself (the verify -> escalate loop) is pure and
// runtime-agnostic in packages/core/src/verification.ts. This file supplies
// the concrete pieces a host adapter needs: a heuristic classifier, a few
// deterministic verification checks, policy presets, and report rendering.

import type {
  ClassifyInput,
  ClassifyResult,
  EscalationPolicy,
  FailureCategory,
  RunOutcome,
  VerificationCheck,
  VerificationCheckResult,
  VerificationResult,
} from './verification'
import type { RoutingPolicy } from './routing'

// --------------------------------------------------------------- classifier

/**
 * Heuristic complexity/risk classifier. Keyword-driven so it is deterministic
 * and testable without a model call. A real deployment could swap in an
 * LLM-based classifier implementing the same ClassifyInput -> ClassifyResult.
 */
export function heuristicClassify(input: ClassifyInput): ClassifyResult {
  const t = (
    input.task +
    ' ' +
    input.agentType +
    ' ' +
    JSON.stringify(input.signals ?? {})
  ).toLowerCase()
  const complexSignals = [
    'refactor',
    'architecture',
    'migration',
    'security',
    'concurrency',
    'distributed',
    'schema',
    'irreversible',
  ]
  const riskSignals = [
    'prod',
    'production',
    'delete',
    'drop',
    'force',
    'release',
    'deploy',
    'migration',
    'irreversible',
  ]
  const complexity = complexSignals.some((s) => t.includes(s)) ? 0.8 : 0.3
  const risk = riskSignals.some((s) => t.includes(s)) ? 0.8 : 0.2
  const effort: RoutingPolicy['effort'] =
    complexity > 0.6 ? 'high' : complexity > 0.3 ? 'medium' : 'low'
  const rationale = `heuristic: complexity ${complexity.toFixed(1)}, risk ${risk.toFixed(1)}`
  return { complexity, risk, effort, rationale }
}

/**
 * Heuristic failure classifier. Maps a verification failure to a retryable
 * category so the engine can decide whether to retry, escalate the route, or
 * abort. A real deployment could swap in a smarter classifier.
 */
export function heuristicClassifyFailure(f: VerificationResult): {
  category: FailureCategory
  detail: string
} {
  const detail = f.failures[0] ?? 'unspecified'
  const text = detail.toLowerCase()
  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('temporarily') ||
    text.includes('retry')
  ) {
    return { category: 'transient', detail }
  }
  if (text.includes('wrong model') || text.includes('too weak') || text.includes('route')) {
    return { category: 'route-mismatch', detail }
  }
  if (text.includes('fatal') || text.includes('unrecoverable')) {
    return { category: 'fatal', detail }
  }
  // Default: logic bug; retrying identically is pointless.
  return { category: 'deterministic', detail }
}

// ------------------------------------------------------------- policy presets

/** A safe default policy: 3 attempts, retry transient + route-mismatch. */
export const DEFAULT_POLICY: EscalationPolicy = {
  maxAttempts: 3,
  retryableFailures: ['transient', 'route-mismatch'],
  fallbackRoutes: [
    { model: 'claude-haiku-4.5', effort: 'low' },
    { model: 'claude-sonnet-4.5', effort: 'medium' },
    { model: 'claude-opus-4.1', effort: 'high' },
  ],
}

/** Strict policy: single attempt, no retries. Used for irreversible tasks. */
export const STRICT_POLICY: EscalationPolicy = {
  maxAttempts: 1,
  retryableFailures: [],
  fallbackRoutes: [{ model: 'claude-opus-4.1', effort: 'high' }],
}

// --------------------------------------------------------- built-in checks

/**
 * A check that passes when the output is a non-empty string (or an object
 * with a non-empty `result`/`text`/`output` field). Useful as a "did the run
 * produce anything at all?" smoke check.
 */
export const nonEmptyCheck: VerificationCheck = {
  name: 'non-empty-output',
  run(output: unknown): VerificationCheckResult {
    if (typeof output === 'string' && output.trim().length > 0) return { passed: true, reason: '' }
    if (typeof output === 'object' && output !== null) {
      const obj = output as Record<string, unknown>
      const field = obj.result ?? obj.text ?? obj.output
      if (typeof field === 'string' && field.trim().length > 0) return { passed: true, reason: '' }
    }
    return { passed: false, reason: 'output was empty', evidence: [] }
  },
}

/** Build a check that passes when the output contains a literal substring. */
export function containsCheck(substring: string): VerificationCheck {
  return {
    name: `contains:${substring}`,
    run(output: unknown): VerificationCheckResult {
      const text = typeof output === 'string' ? output : JSON.stringify(output)
      return text.includes(substring)
        ? { passed: true, reason: '' }
        : {
            passed: false,
            reason: `output did not contain "${substring}"`,
            evidence: [text.slice(0, 200)],
          }
    },
  }
}

/** Build a check that passes when a predicate accepts the output. */
export function predicateCheck(
  name: string,
  pred: (output: unknown) => boolean,
  reason: string,
): VerificationCheck {
  return {
    name,
    run(output: unknown): VerificationCheckResult {
      return pred(output) ? { passed: true, reason: '' } : { passed: false, reason, evidence: [] }
    },
  }
}

/** Run a list of checks; the result passes only when every check passes. */
export async function runChecks(
  output: unknown,
  checks: readonly VerificationCheck[],
): Promise<VerificationResult> {
  const failures: string[] = []
  const evidence: string[] = []
  for (const c of checks) {
    const r = await c.run(output)
    if (!r.passed) {
      failures.push(`${c.name}: ${r.reason}`)
      if (r.evidence) evidence.push(...r.evidence)
    }
  }
  return { passed: failures.length === 0, failures, evidence }
}

// --------------------------------------------------------------- rendering

/** Render a RunOutcome as text for /verify-status and /verify-run. */
export function renderOutcome(outcome: RunOutcome): string {
  const lines: string[] = ['verify run:']
  lines.push(`  status: ${outcome.status}`)
  if (outcome.finalRoute) {
    lines.push(`  final route: ${outcome.finalRoute.model}/${outcome.finalRoute.effort}`)
  }
  lines.push(`  attempts: ${outcome.attempts.length}`)
  for (const a of outcome.attempts) {
    const icon = a.verification.passed ? '✓' : '✗'
    const route = `${a.route.model}/${a.route.effort}`
    const fail = a.failure ? ` [${a.failure.category}: ${a.failure.detail}]` : ''
    lines.push(`    ${icon} attempt ${a.attempt}: ${route}${fail}`)
  }
  return lines.join('\n')
}

/** Summarize a session's runs for /verify-status. */
export function renderStatus(runs: readonly RunOutcome[]): string {
  if (runs.length === 0) return 'verify: no runs this session.'
  const completed = runs.filter((r) => r.status === 'completed').length
  const escalated = runs.filter((r) => r.status === 'escalated').length
  const exhausted = runs.filter((r) => r.status === 'exhausted').length
  const aborted = runs.filter((r) => r.status === 'aborted').length
  const totalAttempts = runs.reduce((n, r) => n + r.attempts.length, 0)
  return [
    'verify session status:',
    `  runs: ${runs.length} (completed ${completed}, escalated ${escalated}, exhausted ${exhausted}, aborted ${aborted})`,
    `  total attempts: ${totalAttempts} (avg ${(totalAttempts / runs.length).toFixed(1)} per run)`,
  ].join('\n')
}
