import type { On } from 'claude-code'
import { ToolStats, report, spinnerSuffix } from './lib/stats'
import { registerCommand } from '@agentic-mods/core'

const stats = new ToolStats()

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'pulse-report',
      description: 'Show per-tool call tally and context pressure for this session',
    })
    await registerCommand($, {
      name: 'pulse-usage',
      description: 'Show a one-line context-window usage readout',
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    stats.record(typeof e?.tool === 'string' ? e.tool : 'unknown')
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async () => undefined)

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    let tokens = 0
    let window = 0
    try {
      const u = await $.session.usage()
      tokens = u?.context?.tokens ?? 0
      window = u?.context?.window ?? 0
    } catch {
      // usage unavailable
    }
    return next({
      ...e,
      props: { ...e.props, suffix: spinnerSuffix(stats.snapshot().attempts, tokens, window) },
    })
  })

  on('command.run', { command: 'pulse-report' }, async ($) => {
    let tokens = 0
    let window = 0
    try {
      const u = await $.session.usage()
      tokens = u?.context?.tokens ?? 0
      window = u?.context?.window ?? 0
    } catch {
      // usage unavailable
    }
    return { text: report(stats.snapshot(), tokens, window) }
  })

  on('command.run', { command: 'pulse-usage' }, async ($) => {
    let t = 0
    let w = 0
    try {
      const u = await $.session.usage()
      t = u?.context?.tokens ?? 0
      w = u?.context?.window ?? 0
    } catch {
      // usage unavailable
    }
    const pct = w > 0 ? Math.round((t / w) * 100) : 0
    return { text: `context ${t}/${w} tokens (${pct}% used)` }
  })
}
