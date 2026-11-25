// pulse: session observability mod.
//
// A thin adapter over lib/stats.ts (pure, unit-tested):
//   - tool.call (all tools)  -> record an attempt, redraw
//   - ui.render Spinner      -> compact readout: attempts + context pressure
//   - /pulse-report          -> per-tool tally + context line
//   - /pulse-usage           -> context line only
//
// Telemetry is in-memory only; nothing leaves the session.

import type { Register } from 'claude-code'
import { ToolStats, report, spinnerSuffix } from './lib/stats'

const stats = new ToolStats()

export const register: Register = (on) => {
  // OBSERVE: register commands once per session.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pulse-report',
      description: 'Show per-tool call tally and context pressure for this session',
    })
    await $.command.register({
      name: 'pulse-usage',
      description: 'Show a one-line context-window usage readout',
    })
    return next(e)
  })

  // OBSERVE: count every tool-call attempt (denied calls included).
  on('tool.call', async ($, e, next) => {
    stats.record(typeof e?.tool === 'string' ? e.tool : 'unknown')
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // REWRITE: append the readout to the spinner.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    let tokens = 0
    let window = 0
    try {
      const u = await $.session.usage()
      tokens = u?.context?.tokens ?? 0
      window = u?.context?.window ?? 0
    } catch {
      // usage unavailable: fall back to zeros rather than breaking the render
    }
    return next({
      ...e,
      props: { ...e.props, suffix: spinnerSuffix(stats.snapshot().attempts, tokens, window) },
    })
  })

  // ANSWER: full report.
  on('command.run', { command: 'pulse-report' }, async ($) => {
    let tokens = 0
    let window = 0
    try {
      const u = await $.session.usage()
      tokens = u?.context?.tokens ?? 0
      window = u?.context?.window ?? 0
    } catch {
      // usage unavailable: fall back to zeros rather than failing the command
    }
    return { text: report(stats.snapshot(), tokens, window) }
  })

  // ANSWER: one-liner.
  on('command.run', { command: 'pulse-usage' }, async ($) => {
    let t = 0
    let w = 0
    try {
      const u = await $.session.usage()
      t = u?.context?.tokens ?? 0
      w = u?.context?.window ?? 0
    } catch {
      // usage unavailable: fall back to zeros rather than failing the command
    }
    const pct = w > 0 ? Math.round((t / w) * 100) : 0
    return { text: `context ${t}/${w} tokens (${pct}% used)` }
  })
}
