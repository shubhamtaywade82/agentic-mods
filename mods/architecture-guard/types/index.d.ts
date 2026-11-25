export type ArchitectureStatus = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  reason: string
  fresh: number
  baseline: number
}

declare module 'claude-code' {
  interface PluginState {
    'architecture-guard': {
      status: Shaped<ArchitectureStatus>
    }
  }
}
