// Session statistics for the pulse mod. Pure TypeScript, no Claude Code
// imports, so it type-checks and unit-tests without a session.

export type ToolTally = Record<string, number>

export interface PulseSnapshot {
  /** Total tool-call attempts (including denied/failed). */
  attempts: number
  /** Attempts per tool name, sorted by count descending. */
  perTool: Array<{ tool: string; count: number }>
}

/**
 * Bounded in-memory tally of tool-call attempts. Mirrors the Mission Control
 * design rule: cap tracked entries instead of retaining unlimited history.
 */
export class ToolStats {
  private readonly tally: ToolTally = {}
  private total = 0
  private readonly maxTools: number

  constructor(maxTools = 50) {
    this.maxTools = maxTools
  }

  record(tool: string): void {
    this.total += 1
    if (this.tally[tool] !== undefined || Object.keys(this.tally).length < this.maxTools) {
      this.tally[tool] = (this.tally[tool] ?? 0) + 1
    }
    // Over the cap and unseen: still counted in total, just not itemized.
  }

  snapshot(): PulseSnapshot {
    const perTool = Object.entries(this.tally)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
    return { attempts: this.total, perTool }
  }

  reset(): void {
    for (const k of Object.keys(this.tally)) delete this.tally[k]
    this.total = 0
  }
}

/** Pressure bands for context-window usage. */
export type Pressure = 'ok' | 'caution' | 'high' | 'critical'

export function pressureBand(ratio: number): Pressure {
  if (!Number.isFinite(ratio)) return 'ok'
  if (ratio >= 0.9) return 'critical'
  if (ratio >= 0.75) return 'high'
  if (ratio >= 0.5) return 'caution'
  return 'ok'
}

/** One-line context readout with a pressure indicator. */
export function contextLine(tokens: number, window: number): string {
  const t = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0
  const w = Number.isFinite(window) && window > 0 ? window : 0
  const pct = w > 0 ? Math.round((t / w) * 100) : 0
  return `context ${t}/${w} (${pct}%, ${pressureBand(w > 0 ? t / w : 0)})`
}

/** Compact spinner suffix: total attempts + context pressure. */
export function spinnerSuffix(attempts: number, tokens: number, window: number): string {
  return ` · pulse: ${attempts} calls, ${contextLine(tokens, window)}`
}

/** Multi-line /pulse-report text. */
export function report(stats: PulseSnapshot, tokens: number, window: number): string {
  const lines = [
    `pulse session report`,
    `  tool-call attempts: ${stats.attempts}`,
    `  ${contextLine(tokens, window)}`,
  ]
  if (stats.perTool.length > 0) {
    lines.push('  per tool:')
    for (const { tool, count } of stats.perTool) {
      lines.push(`    ${tool.padEnd(12)} ${count}`)
    }
  } else {
    lines.push('  per tool: (none yet)')
  }
  return lines.join('\n')
}
