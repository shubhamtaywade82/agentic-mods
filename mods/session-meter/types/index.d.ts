export type MeterState = {
  contextPercent: number | null
  usd: number | null
  rateLimits: Array<{ kind: string; percentUsed: number }>
  warning: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-meter': {
      meter: Shaped<MeterState>
    }
  }
}
