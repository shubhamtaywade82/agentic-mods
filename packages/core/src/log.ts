/** Redaction and audit lines. Anything a mod writes to disk or shows passes through here. */

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd)\b(\s*[:=]\s*)\S+/gi,
]

export function redact(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, ...rest: unknown[]) => {
      const label = typeof rest[0] === 'string' && rest[0].length < 40 ? rest[0] : ''
      const separator = typeof rest[1] === 'string' ? rest[1] : ''
      return label.length > 0 ? `${label}${separator}[redacted]` : '[redacted]'
    })
  }
  return out
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Adds one line to the end of an append-only JSONL file's text and keeps only the newest
 * `cap` lines. The caller reads the file, passes its text here, and writes the result back.
 */
export function appendJsonLine(existing: string, line: string, cap: number): string {
  const lines = existing.split('\n').filter(item => item.length > 0)
  lines.push(line)
  const kept = lines.length > cap ? lines.slice(lines.length - cap) : lines
  return `${kept.join('\n')}\n`
}

/** One JSON line for an audit log. String values are redacted and capped. */
export function auditLine(record: Readonly<Record<string, unknown>>, at: number): string {
  const safe: Record<string, unknown> = { at: new Date(at).toISOString() }
  for (const [key, value] of Object.entries(record)) {
    safe[key] = typeof value === 'string' ? truncate(redact(value), 2000) : value
  }
  return JSON.stringify(safe)
}
