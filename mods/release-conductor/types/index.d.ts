export type GateState = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  phase: string
  reason: string
}

declare module 'claude-code' {
  interface PluginState {
    'release-conductor': {
      gate: Shaped<GateState>
    }
  }
}
