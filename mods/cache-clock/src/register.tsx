import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { cacheState, cacheTtlMs, formatDuration, loadConfig } from '@agentic-mods/core'
import type { CacheClockState } from '../types'

const IDLE: CacheClockState = { lastWriteAt: null, ttlMs: 300_000, remainingMs: null }
const clock = atom({ plugin: 'cache-clock', key: 'clock' } as const, IDLE, { shape: 'clock-1' })

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    // Refresh the countdown. This only redraws the estimate; no request is sent.
    $.clock.every(15_000, async () => {
      const state = await read($, clock)
      if (state.lastWriteAt === null) return
      const now = await $.clock.now()
      const remaining = cacheState(state.lastWriteAt, state.ttlMs, now).remainingMs
      await update($, clock, current => ({ ...current, remainingMs: remaining }))
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const last = e.usage
    if (last !== undefined) {
      const configured = (await loadConfig(path => $.fs.read(path))).value.cache.ttlSeconds
      const ttlMs = cacheTtlMs(last, configured)
      const now = await $.clock.now()
      await update($, clock, () => ({ lastWriteAt: now, ttlMs, remainingMs: ttlMs }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, clock)
    if (state.lastWriteAt === null || state.remainingMs === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const label =
      state.remainingMs > 0
        ? `prompt cache: about ${formatDuration(state.remainingMs)} left (estimate)`
        : 'prompt cache: expired; the next turn rewrites it (estimate)'
    return (
      <Box>
        <Text dimColor>{label}</Text>
      </Box>
    )
  })
}
