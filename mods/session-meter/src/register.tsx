import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { formatPercent, formatUsd, levelOf, loadConfig, rateLevel } from '@agentic-mods/core'
import type { MeterState } from '../types'

const IDLE: MeterState = { contextPercent: null, usd: null, rateLimits: [], warning: null }
const meter = atom({ plugin: 'session-meter', key: 'meter' } as const, IDLE, { shape: 'meter-1' })

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
    if (
      contextPercent !== null &&
      levelOf(contextPercent, config.contextWarnPercent, config.contextCriticalPercent) !== 'ok'
    ) {
      warnings.push(`context ${formatPercent(contextPercent)}`)
    }
    if (usd !== null && usd >= config.costWarnUsd) warnings.push(`cost ${formatUsd(usd)}`)
    for (const limit of rateLimits) {
      if (rateLevel(limit.percentUsed, config.rateWarnPercent) !== 'ok') {
        warnings.push(`${limit.kind} ${formatPercent(limit.percentUsed)}`)
      }
    }
    const warning = warnings.length > 0 ? warnings.join(', ') : null

    const previous = await read($, meter)
    await update($, meter, () => ({ contextPercent, usd, rateLimits, warning }))
    if (warning !== null && warning !== previous.warning) {
      $.ui.toast(`session-meter: ${warning}`)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, meter)
    if (state.contextPercent === null && state.usd === null && state.rateLimits.length === 0) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const parts: string[] = []
    if (state.contextPercent !== null) parts.push(`context ${formatPercent(state.contextPercent)}`)
    if (state.usd !== null) parts.push(`cost ${formatUsd(state.usd)}`)
    for (const limit of state.rateLimits)
      parts.push(`${limit.kind} ${formatPercent(limit.percentUsed)}`)
    return (
      <Box>
        <Text dimColor={state.warning === null}>
          {parts.join(' · ')}
          {state.warning === null ? '' : ` · warning: ${state.warning}`}
        </Text>
      </Box>
    )
  })
}
