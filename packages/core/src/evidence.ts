import type { CheckName } from './classify'
import { type Decision, type Mode, type Verdict, violation, worstVerdict } from './policy'
import type { StrengthRun } from './strength'

/**
 * One recorded run of a check. `source` is `run` only when this mod executed the configured
 * argv itself and read its exit code. Observed tool output never carries an exit code here.
 *
 * A `strength` record carries the mutation run: a strength pass depends on the score against
 * the threshold, not only on the exit code, so the parsed result travels with the record.
 */
export type CheckRecord = {
  check: CheckName
  argv: string[]
  exitCode: number | null
  fingerprint: string | null
  ranAt: number
  durationMs: number
  source: 'run' | 'observed'
  strength?: StrengthRun
}

export type CheckStatus = {
  check: CheckName
  verdict: Verdict
  reason: string
  record: CheckRecord | null
}

/**
 * Turns the latest records into verdicts. Rules, in order:
 *  - no record              -> UNKNOWN (not run)
 *  - observed, no run       -> UNKNOWN (tool output cannot prove a pass)
 *  - no exit code           -> UNKNOWN
 *  - non-zero exit code     -> FAIL
 *  - no current fingerprint -> UNKNOWN (repository state unreadable)
 *  - fingerprint differs    -> STALE (files changed after the run)
 *  - older than max age     -> STALE
 *  - otherwise              -> PASS
 *
 * A `strength` record is judged on its recorded mutation run first: `incomplete` (timeout,
 * missing tool, unparsable output) is UNKNOWN — the score is unknown, never silently skipped —
 * and a score below the threshold is FAIL before the freshness rules apply.
 */
export function evaluateChecks(
  required: readonly CheckName[],
  latest: ReadonlyMap<CheckName, CheckRecord>,
  currentFingerprint: string | null,
  nowMs: number,
  maxAgeMs: number,
): CheckStatus[] {
  return required.map((check) => {
    const record = latest.get(check) ?? null
    if (record === null) {
      return { check, verdict: 'UNKNOWN', reason: 'not run', record }
    }
    if (record.source !== 'run') {
      return { check, verdict: 'UNKNOWN', reason: 'observed only; never a pass', record }
    }
    if (check === 'strength') {
      const strength = record.strength
      if (strength === undefined) {
        return { check, verdict: 'UNKNOWN', reason: 'no mutation result recorded', record }
      }
      const tally =
        strength.counts === null
          ? ''
          : ` (${strength.counts.mutantsKilled}/${strength.counts.mutantsGenerated} mutants killed)`
      // An incomplete run (budget exceeded, tool missing, unparsable output) is UNKNOWN:
      // the score is unknown and never silently skipped. A known score below the threshold
      // is FAIL regardless of the exit code; at or above it, the freshness rules apply.
      if (strength.status === 'incomplete') {
        return { check, verdict: 'UNKNOWN', reason: `incomplete: ${strength.summary}`, record }
      }
      if (strength.status === 'failed') {
        return {
          check,
          verdict: 'FAIL',
          reason: `mutation score ${strength.score}%${tally} below threshold ${strength.threshold}%`,
          record,
        }
      }
      if (currentFingerprint === null) {
        return { check, verdict: 'UNKNOWN', reason: 'repository state unreadable', record }
      }
      if (record.fingerprint !== currentFingerprint) {
        return { check, verdict: 'STALE', reason: 'files changed after the run', record }
      }
      if (nowMs - record.ranAt > maxAgeMs) {
        return { check, verdict: 'STALE', reason: 'older than the configured age', record }
      }
      return { check, verdict: 'PASS', reason: `mutation score ${strength.score}%${tally}`, record }
    }
    if (record.exitCode === null) {
      return { check, verdict: 'UNKNOWN', reason: 'exit code unavailable', record }
    }
    if (record.exitCode !== 0) {
      return { check, verdict: 'FAIL', reason: `exit ${record.exitCode}`, record }
    }
    if (currentFingerprint === null) {
      return { check, verdict: 'UNKNOWN', reason: 'repository state unreadable', record }
    }
    if (record.fingerprint !== currentFingerprint) {
      return { check, verdict: 'STALE', reason: 'files changed after the run', record }
    }
    if (nowMs - record.ranAt > maxAgeMs) {
      return { check, verdict: 'STALE', reason: 'older than the configured age', record }
    }
    return { check, verdict: 'PASS', reason: 'current', record }
  })
}

export function overallVerdict(statuses: readonly CheckStatus[]): Verdict {
  return worstVerdict(statuses.map((status) => status.verdict))
}

export type GatedAction = 'commit' | 'push' | 'pr-create'

/** A gated action is allowed only when every required check is PASS. */
export function gateDecision(
  action: GatedAction,
  statuses: readonly CheckStatus[],
  mode: Mode,
): Decision {
  const blocking = statuses.filter((status) => status.verdict !== 'PASS')
  const label = action === 'pr-create' ? 'pull request' : action
  if (blocking.length === 0) {
    return { decision: 'allow', policyId: 'evidence-gate', message: `${label}: evidence current` }
  }
  const detail = blocking.map((status) => `${status.check} ${status.verdict} (${status.reason})`)
  return violation(
    mode,
    'evidence-gate',
    `${label} needs current evidence: ${detail.join('; ')}`,
    'Run /evidence run to refresh the required checks, then retry.',
  )
}
