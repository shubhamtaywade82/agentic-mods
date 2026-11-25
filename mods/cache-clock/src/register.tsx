import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { cacheState, cacheTtlMs, formatDuration, loadConfig } from '@agentic-mods/core'
import type { CacheClockState } from '../types'
import { band } from '../../../packages/core/src/ui'

const IDLE: CacheClockState = { lastWriteAt: null, ttlMs: 300_000, remainingMs: null }
const clock = atom({ plugin: 'cache-clock', key: 'clock' } as const, IDLE, { shape: 'clock-1' })

let stopCountdown: (() => void) | null = null

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    // Refresh the countdown. This only redraws the estimate; no request is sent.
    const handle = $.clock.every(15_000, async () => {
      const state = await read($, clock)
      if (state.lastWriteAt === null) return
      const now = await $.clock.now()
      const remaining = cacheState(state.lastWriteAt, state.ttlMs, now).remainingMs
      await update($, clock, (current) => ({ ...current, remainingMs: remaining }))
    })
    stopCountdown = () => handle.cancel()
    return next(e)
  })

  on('session.end', (_$, e, next) => {
    stopCountdown?.()
    stopCountdown = null
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const last = e.usage
    if (last !== undefined) {
      const configured = (await loadConfig((path) => $.fs.read(path))).value.cache.ttlSeconds
      const ttlMs = cacheTtlMs(last, configured)
      const now = await $.clock.now()
      await update($, clock, () => ({ lastWriteAt: now, ttlMs, remainingMs: ttlMs }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, clock)
    if (state.lastWriteAt === null || state.remainingMs === null) return next(e)
    const kit = $.ui.resolve(e)
    if (state.remainingMs <= 0) {
      return band(kit, 'cache', [
        { text: '⌛ expired', tone: 'error', bold: true },
        { text: 'the next turn rewrites it (estimate)', tone: 'subtle' },
      ])
    }
    // Under five minutes left, the next turn is worth sending soon.
    const tone = state.remainingMs < 5 * 60_000 ? 'warning' : 'success'
    return band(kit, 'cache', [
      { text: `⏱ ${formatDuration(state.remainingMs)} left`, tone, bold: true },
      { text: 'estimate', tone: 'subtle' },
    ])
  })
}
