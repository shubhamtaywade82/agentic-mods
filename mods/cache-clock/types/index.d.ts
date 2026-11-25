export type CacheClockState = {
  lastWriteAt: number | null
  ttlMs: number
  remainingMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': {
      clock: Shaped<CacheClockState>
    }
  }
}
