import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { formatPercent, formatUsd, levelOf, loadConfig, rateLevel } from '@agentic-mods/core'
import type { MeterState } from '../types'
import { band, gauge, type Segment } from '../../../packages/core/src/ui'

const IDLE: MeterState = { contextPercent: null, usd: null, rateLimits: [], warning: null }
const meter = atom({ plugin: 'session-meter', key: 'meter' } as const, IDLE, { shape: 'meter-1' })

// Which thresholds are crossed, without the live values, so a toast fires on a crossing and not
// on every measurement. Resets on reload, which at worst repeats one toast.
let crossedKinds = ''

export function register(on: On): void {
  on('session.measure', async ($, e, next) => {
    const config = (await loadConfig((path) => $.fs.read(path))).value.meter
    const windowSize = e.context.window
    const tokens = e.context.tokens ?? 0
    const contextPercent = windowSize > 0 ? (tokens / windowSize) * 100 : null
    const usd = e.cost?.usd ?? null
    const rateLimits = e.rateLimits.map((limit) => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
    }))

    const warnings: string[] = []
    const kinds: string[] = []
    if (
      contextPercent !== null &&
      levelOf(contextPercent, config.contextWarnPercent, config.contextCriticalPercent) !== 'ok'
    ) {
      warnings.push(`context ${formatPercent(contextPercent)}`)
      kinds.push('context')
    }
    if (usd !== null && usd >= config.costWarnUsd) {
      warnings.push(`cost ${formatUsd(usd)}`)
      kinds.push('cost')
    }
    for (const limit of rateLimits) {
      if (rateLevel(limit.percentUsed, config.rateWarnPercent) !== 'ok') {
        warnings.push(`${limit.kind} ${formatPercent(limit.percentUsed)}`)
        kinds.push(limit.kind)
      }
    }
    const warning = warnings.length > 0 ? warnings.join(', ') : null

    await update($, meter, () => ({ contextPercent, usd, rateLimits, warning }))
    const kindsNow = kinds.join(',')
    if (warning !== null && kindsNow !== crossedKinds) $.ui.toast(`session-meter: ${warning}`)
    crossedKinds = kindsNow
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, meter)
    if (state.contextPercent === null && state.usd === null && state.rateLimits.length === 0) {
      return next(e)
    }
    const segments: Segment[] = []
    if (state.contextPercent !== null) {
      // The 70% and 90% marks match the default config thresholds.
      const tone =
        state.contextPercent >= 90 ? 'error' : state.contextPercent >= 70 ? 'warning' : 'success'
      segments.push({
        text: `${gauge(state.contextPercent)} ${formatPercent(state.contextPercent)} context`,
        tone,
        bold: true,
      })
    }
    if (state.usd !== null) segments.push({ text: `cost ${formatUsd(state.usd)}` })
    for (const limit of state.rateLimits) {
      const tone = limit.percentUsed >= 80 ? 'warning' : 'subtle'
      segments.push({ text: `${limit.kind} ${formatPercent(limit.percentUsed)}`, tone })
    }
    if (state.warning !== null)
      segments.push({ text: `▲ ${state.warning}`, tone: 'warning', bold: true })
    return band($.ui.resolve(e), 'session', segments)
  })
}
