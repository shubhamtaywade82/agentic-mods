// Approval + git-diff gate for the guardian mod. Pure TypeScript.
//
// This is the third enforcement tier, modelled on Blast Radius: instead of
// only block-or-pass, certain operations are HELD with an impact preview, and
// proceed only on explicit human approval. Unanswered / non-interactive
// sessions are cancelled (fail closed), never silently allowed.
//
// Two gates use it:
//   - destructive Bash commands (rm -rf, force push, migrations) -> hold + preview
//   - git commit/push whose staged diff contains a secret          -> hold + preview

/** Why an operation is being held for approval. */
export type GateReason =
  | 'destructive-command'
  | 'diff-contains-secret'
  | 'diff-oversized'
  | 'noninteractive-block'

/** A held operation awaiting a decision. */
export interface HeldOp {
  /** The original command string the caller asked to run. */
  readonly command: string
  readonly reason: GateReason
  /** Human-readable impact preview, shown before approval. */
  readonly preview: string
  /** Whether the impact was actually computed (false => conservative block). */
  readonly previewComputed: boolean
}

/** A decision the host returns for a held operation. */
export type ApprovalDecision = 'approve' | 'deny' | 'timeout'

/** Match a destructive Bash command to a held operation. */
export interface GateMatcher {
  test(command: string): HeldOp | null
}

/**
 * Build a held-op for a command that already matched a blast rule. The
 * preview explains the impact without echoing the command verbatim (the
 * caller already shows the command; we describe what it WOULD do).
 */
export function holdForBlast(
  command: string,
  match: { kind: string; why: string },
): HeldOp {
  return {
    command,
    reason: 'destructive-command',
    preview: `This command (${match.kind}) ${match.why}. Review the impact above before approving. If you did not expect this, deny it.`,
    previewComputed: true,
  }
}

/**
 * Build a held-op when a git diff contains a secret. The preview names the
 * kinds found (never their values) and warns the diff would enter history.
 */
export function holdForSecretDiff(
  command: string,
  kinds: readonly string[],
  diffStat: { files: number; insertions: number; deletions: number },
): HeldOp {
  const kindList = [...new Set(kinds)].join(', ')
  const preview =
    `The staged diff this command would commit/push contains what looks like a real secret (${kindList}). ` +
    `Diff: ${diffStat.files} file(s), +${diffStat.insertions}/-${diffStat.deletions}. ` +
    `Approving writes the secret into git history. Move the value to an env var or secret manager and re-stage instead.`
  return {
    command,
    reason: 'diff-contains-secret',
    preview,
    previewComputed: true,
  }
}

/**
 * Build a held-op when the diff is too large to scan safely. We refuse to
 * approve what we could not inspect.
 */
export function holdForOversizedDiff(command: string, bytes: number, limit: number): HeldOp {
  return {
    command,
    reason: 'diff-oversized',
    preview: `The staged diff is ${bytes} bytes, above the scan limit of ${limit}. guardian will not approve a diff it could not inspect. Stage smaller hunks or split the commit.`,
    previewComputed: false,
  }
}

/**
 * Decide a held op when the session is non-interactive (no human can answer).
 * Destructive commands and secret diffs are DENIED; everything else is also
 * denied because there is nobody to confirm it.
 */
export function decideNoninteractive(op: HeldOp): ApprovalDecision {
  void op
  return 'deny'
}

/** True when a git command writes to history or remotes. */
export function isHistoryMutating(command: string): boolean {
  return /\bgit\s+(commit|push|tag|merge\s+--(no-)?ff|rebase)\b/.test(command)
}

/** True when a git command reads history (we don't gate reads). */
export function isHistoryRead(command: string): boolean {
  return /\bgit\s+(diff|log|show|status|blame|stash\s+list)\b/.test(command)
}

/** The default byte limit for a diff we will scan; larger diffs are held. */
export const DEFAULT_DIFF_LIMIT = 256 * 1024 // 256 KiB

/**
 * Conservative diff statistics parser. Counts `+++`/`---` file headers and
 * `+`/`-` body lines. Returns zeros on empty/garbage input; never throws.
 */
export function diffStat(diff: string): { files: number; insertions: number; deletions: number } {
  if (!diff) return { files: 0, insertions: 0, deletions: 0 }
  let files = 0
  let insertions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      if (line.startsWith('+++') && line !== '+++') files += 0 // counted via --- b/...
      continue
    }
    if (line.startsWith('diff --git')) {
      files += 1
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) insertions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  // Fallback: if no diff --git headers, count +++ b/... lines as files.
  if (files === 0) {
    files = diff.split('\n').filter((l) => l.startsWith('+++ b/')).length
  }
  return { files, insertions, deletions }
}
