export type GateState = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  phase: string
  reason: string
}

declare module 'claude-code' {
  interface PluginState {
    'observability-verifier': {
      gate: Shaped<GateState>
    }
  }
}
