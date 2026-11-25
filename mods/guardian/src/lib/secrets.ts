// Secret detection and redaction for the guardian mod. Pure TypeScript, no
// Claude Code imports, so it is unit-testable without a session.
//
// Design notes (from the reference security reviews):
// - Redaction is value-anchored: a finding is only accepted when the exact
//   matched substring occurs in the text we are about to redact. We never
//   redact "by kind" across unrelated output.
// - Show-or-block is decided per finding; the caller can block on
//   write/commit paths and redact on read paths.

export type FindingKind =
  | 'aws-access-key'
  | 'aws-secret-key'
  | 'github-pat'
  | 'slack-token'
  | 'google-api-key'
  | 'private-key'
  | 'generic-bearer'
  | 'env-assignment'

export interface SecretFinding {
  /** Which pattern matched. */
  kind: FindingKind
  /** The exact matched substring (kept only in memory, never rendered). */
  value: string
  /** Index of the match in the scanned text. */
  index: number
}

export interface SecretPattern {
  kind: FindingKind
  regex: RegExp
}

/**
 * Built-in patterns. High-signal, low-false-positive shapes only. Value
 * character classes are deliberately conservative (no spaces) so prose never
 * matches.
 */
export const PATTERNS: readonly SecretPattern[] = [
  // AKIA followed by 16 uppercase letters/digits
  { kind: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  // GitHub personal access tokens (classic ghp_, fine-grained github_pat_)
  { kind: 'github-pat', regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  // xoxb-/xoxp-/xoxa- style Slack tokens
  { kind: 'slack-token', regex: /\bxox[abpori]-[A-Za-z0-9-]{10,}\b/g },
  // Google API keys: AIza...
  { kind: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // PEM private key headers (with or without the RSA/EC marker)
  { kind: 'private-key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  // Generic bearer tokens of real length
  { kind: 'generic-bearer', regex: /\b(?:Bearer|bearer)\s+[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}/g },
  // AWS secret access keys assigned in env-style text (40 chars base64ish)
  { kind: 'aws-secret-key', regex: /\b[A-Za-z0-9/+=]{40}\b/g },
  // TOKEN=..., PASSWORD=..., SECRET=... assignments with a non-empty value
  {
    kind: 'env-assignment',
    regex:
      /\b(?:API_KEY|TOKEN|PASSWORD|PASSWD|SECRET|ACCESS_KEY|PRIVATE_TOKEN)[A-Z_]*\s*[:=]\s*['"]?[^\s'"]{8,}/g,
  },
] as const

/** Kinds that indicate a near-certain real secret (not a maybe). */
const HIGH_SIGNAL: ReadonlySet<FindingKind> = new Set([
  'aws-access-key',
  'github-pat',
  'slack-token',
  'google-api-key',
  'private-key',
])

export function isHighSignal(kind: FindingKind): boolean {
  return HIGH_SIGNAL.has(kind)
}

/** Scan text for secrets. Returns findings sorted by index. */
export function scan(text: string): SecretFinding[] {
  if (!text) return []
  const out: SecretFinding[] = []
  for (const p of PATTERNS) {
    const re = new RegExp(p.regex.source, p.regex.flags) // fresh lastIndex
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) break // safety for zero-width matches
      out.push({ kind: p.kind, value: m[0], index: m.index })
      if (out.length >= 100) break // cap pathological input
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * Redact every finding from text, replacing the exact matched value with
 * `[redacted:<kind>]`. Overlapping findings (e.g. env-assignment containing
 * an aws-secret-key) collapse into one span; the later (inner) finding is
 * dropped inside an already-redacted span.
 */
export function redact(text: string, findings: SecretFinding[]): string {
  if (findings.length === 0) return text

  // Merge overlapping spans, keeping the outermost.
  const spans: Array<{ start: number; end: number; kind: FindingKind }> = []
  for (const f of findings) {
    const start = f.index
    const end = f.index + f.value.length
    const prev = spans[spans.length - 1]
    if (prev && start <= prev.end) continue // inside or adjacent to previous span
    spans.push({ start, end, kind: f.kind })
  }

  let out = ''
  let cursor = 0
  for (const s of spans) {
    out += text.slice(cursor, s.start)
    out += `[redacted:${s.kind}]`
    cursor = s.end
  }
  out += text.slice(cursor)
  return out
}

/** True when any finding is high-signal. Used to hard-block writes. */
export function hasHighSignal(findings: SecretFinding[]): boolean {
  return findings.some((f) => isHighSignal(f.kind))
}

/**
 * A human-safe denial reason. Never includes the secret value or the kind of
 * only-maybe findings; names kinds when at least one is high-signal.
 */
export function denyReason(findings: SecretFinding[]): string | null {
  const high = findings.filter((f) => isHighSignal(f.kind))
  if (high.length === 0) return null
  const kinds = [...new Set(high.map((f) => f.kind))].join(', ')
  return (
    `guardian: refusing this call - it would expose what looks like a real secret (${kinds}). ` +
    'Move the value into an environment variable or secret manager and rewrite the command.'
  )
}

/**
 * Count secrets by kind; used by the /guardian-report command. Values are
 * never included, only counts.
 */
export function summarize(findings: SecretFinding[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1
  return out
}

/**
 * Redact secrets from a tool RESULT before the model sees it. Tool results
 * arrive in many shapes (plain string, { stdout }, { text }, arrays of
 * content blocks). This walks the common shapes and returns a redacted copy
 * WITHOUT mutating the original. Findings are merged across all scanned
 * string fields so the caller can report one summary.
 *
 * Returns the redacted result and the findings that were found.
 */
export function redactResult(result: unknown): { result: unknown; findings: SecretFinding[] } {
  if (result == null) return { result, findings: [] }
  if (typeof result === 'string') {
    const findings = scan(result)
    return { result: findings.length ? redact(result, findings) : result, findings }
  }
  if (Array.isArray(result)) {
    const allFindings: SecretFinding[] = []
    const out = result.map((item) => {
      const r = redactResult(item)
      allFindings.push(...r.findings)
      return r.result
    })
    return { result: out, findings: allFindings }
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>
    const fields = ['stdout', 'stderr', 'text', 'output', 'content', 'result']
    let touched = false
    const allFindings: SecretFinding[] = []
    const out: Record<string, unknown> = { ...obj }
    for (const f of fields) {
      if (typeof obj[f] === 'string') {
        const r = redactResult(obj[f])
        if (r.findings.length > 0) {
          out[f] = r.result
          allFindings.push(...r.findings)
          touched = true
        }
      }
    }
    return { result: touched ? out : result, findings: allFindings }
  }
  return { result, findings: [] }
}
