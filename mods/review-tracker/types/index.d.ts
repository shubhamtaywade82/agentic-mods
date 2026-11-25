export type ReviewGate = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  openHigh: number
  open: number
  reason: string
}

declare module 'claude-code' {
  interface PluginState {
    'review-tracker': {
      gate: Shaped<ReviewGate>
    }
  }
}
