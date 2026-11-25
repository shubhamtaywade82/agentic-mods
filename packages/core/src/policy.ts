/**
 * Verdicts are the only vocabulary a mod may use to describe a check.
 * PASS requires current evidence. Missing evidence is UNKNOWN, never PASS.
 */
export type Verdict = 'PASS' | 'FAIL' | 'STALE' | 'UNKNOWN'

const RANK: Record<Verdict, number> = { PASS: 0, STALE: 1, UNKNOWN: 2, FAIL: 3 }

/** The worst verdict of a set. An empty set is UNKNOWN. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) return 'UNKNOWN'
  let worst: Verdict = 'PASS'
  for (const verdict of verdicts) {
    if (RANK[verdict] > RANK[worst]) worst = verdict
  }
  return worst
}

/**
 * `observe` records only, `warn` shows the reason, `enforce` refuses the action.
 * Every mod that refuses an action takes one of these, so behaviour is configured in one place.
 */
export type Mode = 'observe' | 'warn' | 'enforce'

export type DecisionKind = 'allow' | 'warn' | 'block'

export type Decision = {
  decision: DecisionKind
  policyId: string
  message: string
  remediation?: string
}

export function allowed(policyId: string): Decision {
  return { decision: 'allow', policyId, message: '' }
}

/** Turns a violation into a decision according to the configured mode. */
export function violation(
  mode: Mode,
  policyId: string,
  message: string,
  remediation?: string,
): Decision {
  const decision: DecisionKind = mode === 'enforce' ? 'block' : mode === 'warn' ? 'warn' : 'allow'
  return remediation === undefined
    ? { decision, policyId, message }
    : { decision, policyId, message, remediation }
}

/** The text a refusal shows the model or the person. */
export function describeDecision(decision: Decision): string {
  const head = `[${decision.policyId}] ${decision.message}`
  return decision.remediation === undefined ? head : `${head} ${decision.remediation}`
}

export function isBlocking(decision: Decision): boolean {
  return decision.decision === 'block'
}
