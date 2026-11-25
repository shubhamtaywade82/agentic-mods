// Pure formatting of session usage data for mod-template. No Claude Code
// imports here so it can be type-checked and unit-tested without a session.

/** Minimal structural types for the values $.session.usage() returns. */
export interface ContextUsage {
  tokens: number
  window: number
}

export interface RateLimitUsage {
  kind: string
  percentUsed: number
}

export interface SessionUsage {
  context: ContextUsage
  rateLimits: RateLimitUsage[]
}

/**
 * Render a one-line usage readout.
 *
 * Regression-tested for: populated data, empty rate limits, multiple windows,
 * and out-of-range/malformed numbers (rendered defensively, never NaN).
 */
export function formatUsage(u: SessionUsage): string {
  const tokens = finiteOr(0, u?.context?.tokens)
  const window = finiteOr(0, u?.context?.window)
  const limits = Array.isArray(u?.rateLimits) ? u.rateLimits : []

  const limitText = limits.length
    ? limits.map((l) => `${l.kind} ${finiteOr(0, l?.percentUsed)}% used`).join(', ')
    : 'no plan-limit data'

  return `context: ${tokens}/${window} tokens; ${limitText}`
}

function finiteOr(fallback: number, v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
