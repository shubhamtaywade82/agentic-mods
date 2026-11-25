import { type Verdict, worstVerdict } from './policy'

/**
 * The release-readiness decision. It reads only the verdicts that other mods publish, so the
 * decision has one definition, shared by pr-readiness and the engineering cockpit.
 *
 * Rules:
 *  - unapproved contract violations are FAIL (scope was exceeded);
 *  - evidence must be PASS for every required check;
 *  - review and architecture verdicts must be PASS;
 *  - any FAIL means NOT READY; anything not PASS and not FAIL means UNKNOWN. Never READY.
 */
export type ReadinessInput = {
  contract: { active: boolean; violations: number; mode: string }
  evidence: { overall: Verdict; checks: ReadonlyArray<{ check: string; verdict: Verdict; reason: string }> }
  review: { verdict: Verdict; reason: string }
  architecture: { verdict: Verdict; reason: string }
}

export type ReadinessItem = {
  label: string
  verdict: Verdict
  detail: string
}

export type Readiness = {
  verdict: 'READY' | 'NOT READY' | 'UNKNOWN'
  items: ReadinessItem[]
}

export function assessReadiness(input: ReadinessInput): Readiness {
  const scope: ReadinessItem = !input.contract.active
    ? { label: 'Scope', verdict: 'UNKNOWN', detail: 'no change contract recorded' }
    : input.contract.violations === 0
      ? { label: 'Scope', verdict: 'PASS', detail: `within contract (${input.contract.mode})` }
      : {
          label: 'Scope',
          verdict: 'FAIL',
          detail: `${input.contract.violations} write(s) outside the contract`,
        }

  const failing = input.evidence.checks.filter(item => item.verdict !== 'PASS')
  const evidence: ReadinessItem = {
    label: 'Evidence',
    verdict: input.evidence.overall,
    detail:
      input.evidence.checks.length === 0
        ? 'no checks configured or run'
        : failing.length === 0
          ? 'all required checks current'
          : failing.map(item => `${item.check} ${item.verdict} (${item.reason})`).join('; '),
  }

  const review: ReadinessItem = { label: 'Review', verdict: input.review.verdict, detail: input.review.reason }
  const architecture: ReadinessItem = {
    label: 'Architecture',
    verdict: input.architecture.verdict,
    detail: input.architecture.reason,
  }

  const items = [scope, evidence, review, architecture]
  const overall = worstVerdict(items.map(item => item.verdict))
  const verdict: Readiness['verdict'] =
    overall === 'PASS' ? 'READY' : overall === 'FAIL' ? 'NOT READY' : 'UNKNOWN'
  return { verdict, items }
}

/**
 * A pull-request description built only from recorded results. A check that has no current
 * evidence is listed as not verified, never as passed.
 */
export function describeEvidence(input: ReadinessInput): string {
  const lines = ['## Verification', '']
  if (input.evidence.checks.length === 0) {
    lines.push('- No checks were configured or run for this change.')
  }
  for (const item of input.evidence.checks) {
    const mark = item.verdict === 'PASS' ? 'passed' : item.verdict === 'FAIL' ? 'FAILED' : 'not verified'
    lines.push(`- ${item.check}: ${mark} (${item.reason})`)
  }
  lines.push('', '## Scope', '')
  lines.push(
    input.contract.active
      ? `- Contract mode ${input.contract.mode}; ${input.contract.violations} write(s) outside scope.`
      : '- No change contract recorded.',
  )
  lines.push('', '## Review', '', `- ${input.review.reason}`)
  return lines.join('\n')
}
