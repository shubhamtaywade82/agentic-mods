export type GateState = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  phase: string
  reason: string
}

declare module 'claude-code' {
  interface PluginState {
    'defect-protocol': {
      gate: Shaped<GateState>
      defect: Shaped<Record<string, string>>
    }
  }
}
