export type RadarStatus = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  changes: string[]
  scan: string
}

declare module 'claude-code' {
  interface PluginState {
    'dependency-radar': {
      status: Shaped<RadarStatus>
    }
  }
}
