/* Pure session arithmetic. Inputs come from engine events; nothing here reads the engine. */

export type Level = 'ok' | 'warn' | 'critical'

export function levelOf(percent: number, warnAt: number, criticalAt: number): Level {
  if (percent >= criticalAt) return 'critical'
  if (percent >= warnAt) return 'warn'
  return 'ok'
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export type CacheUsage = {
  ephemeral_5m_input_tokens?: number | undefined
  ephemeral_1h_input_tokens?: number | undefined
}

/**
 * The prompt cache's lifetime for the last turn. A write made for one hour is kept for one
 * hour. Otherwise the five-minute lifetime applies, or the configured TTL when it is known.
 */
export function cacheTtlMs(usage: CacheUsage | undefined, configuredSeconds: number): number {
  if (usage !== undefined && (usage.ephemeral_1h_input_tokens ?? 0) > 0) return 60 * 60 * 1000
  return configuredSeconds * 1000
}

export type CacheState = {
  remainingMs: number
  isExpired: boolean
}

export function cacheState(lastWriteAt: number, ttlMs: number, now: number): CacheState {
  const remainingMs = lastWriteAt + ttlMs - now
  return { remainingMs: Math.max(0, remainingMs), isExpired: remainingMs <= 0 }
}

export function rateLevel(percentUsed: number, warnAt: number): Level {
  if (percentUsed >= 100) return 'critical'
  return percentUsed >= warnAt ? 'warn' : 'ok'
}
