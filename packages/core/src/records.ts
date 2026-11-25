import { type Verdict } from './policy'

/* ---------- review findings ---------- */

export type Severity = 'high' | 'medium' | 'low'
export type FindingStatus = 'open' | 'in-progress' | 'fixed' | 'verified' | 'rejected' | 'deferred'
export type FindingAction = 'start' | 'fix' | 'verify' | 'reject' | 'defer' | 'reopen'

export type Finding = {
  id: string
  title: string
  severity: Severity
  status: FindingStatus
  file: string | null
  reason: string | null
  evidence: string | null
  updatedAt: number
}

const FINDING_TRANSITIONS: Readonly<Record<FindingStatus, Partial<Record<FindingAction, FindingStatus>>>> = {
  open: { start: 'in-progress', fix: 'fixed', reject: 'rejected', defer: 'deferred' },
  'in-progress': { fix: 'fixed', reject: 'rejected', defer: 'deferred' },
  fixed: { verify: 'verified', reopen: 'open' },
  verified: { reopen: 'open' },
  rejected: { reopen: 'open' },
  deferred: { reopen: 'open', start: 'in-progress' },
}

export type TransitionResult = { ok: true; status: FindingStatus } | { ok: false; reason: string }

/**
 * Applies a lifecycle action. `verify` needs evidence and `reject` or `defer` needs a reason,
 * so a resolved finding always says why it is resolved.
 */
export function transitionFinding(
  current: FindingStatus,
  action: FindingAction,
  details: { evidence?: string | null; reason?: string | null },
): TransitionResult {
  const next = FINDING_TRANSITIONS[current][action]
  if (next === undefined) {
    return { ok: false, reason: `cannot ${action} a finding that is ${current}` }
  }
  if (action === 'verify' && !(details.evidence && details.evidence.trim().length > 0)) {
    return { ok: false, reason: 'verifying a finding needs evidence' }
  }
  if (
    (action === 'reject' || action === 'defer') &&
    !(details.reason && details.reason.trim().length > 0)
  ) {
    return { ok: false, reason: `${action === 'reject' ? 'rejecting' : 'deferring'} needs a reason` }
  }
  return { ok: true, status: next }
}

export type FindingGate = {
  verdict: Verdict
  openHigh: number
  open: number
  reason: string
}

/**
 * Review gate. No findings recorded is UNKNOWN: a review may not have happened. Any unresolved
 * high-severity finding is FAIL. Unresolved means open or in progress.
 */
export function gateFindings(findings: readonly Finding[]): FindingGate {
  if (findings.length === 0) {
    return { verdict: 'UNKNOWN', openHigh: 0, open: 0, reason: 'no review findings recorded' }
  }
  const unresolved = findings.filter(
    finding => finding.status === 'open' || finding.status === 'in-progress',
  )
  const openHigh = unresolved.filter(finding => finding.severity === 'high').length
  if (openHigh > 0) {
    return {
      verdict: 'FAIL',
      openHigh,
      open: unresolved.length,
      reason: `${openHigh} high-severity finding${openHigh === 1 ? '' : 's'} unresolved`,
    }
  }
  return {
    verdict: 'PASS',
    openHigh: 0,
    open: unresolved.length,
    reason: unresolved.length === 0 ? 'all findings resolved' : `${unresolved.length} lower-severity open`,
  }
}

/* ---------- learned lessons ---------- */

export type LessonStatus = 'proposed' | 'approved' | 'rejected' | 'stale'
export type LessonAction = 'approve' | 'reject' | 'retire'

export type LessonLink = {
  path: string
  fingerprint: string | null
}

export type Lesson = {
  id: string
  text: string
  scope: string[]
  links: LessonLink[]
  status: LessonStatus
  createdAt: number
}

export function transitionLesson(
  current: LessonStatus,
  action: LessonAction,
): LessonStatus | null {
  if (current === 'proposed') {
    if (action === 'approve') return 'approved'
    if (action === 'reject') return 'rejected'
    return null
  }
  if (current === 'approved' && action === 'retire') return 'rejected'
  if (current === 'stale' && action === 'retire') return 'rejected'
  if (current === 'approved' && action === 'reject') return null
  return null
}

/**
 * Links whose file fingerprint no longer matches. A lesson with a changed link is stale and
 * must be reviewed before it is relied on again.
 */
export function staleLinks(
  lesson: Lesson,
  current: ReadonlyMap<string, string | null>,
): string[] {
  return lesson.links
    .filter(link => {
      if (!current.has(link.path)) return true
      return current.get(link.path) !== link.fingerprint
    })
    .map(link => link.path)
}

/* ---------- ring of recent items ---------- */

export function newestFirst<T>(items: readonly T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit)).reverse()
}
