export type ImpactStatus = {
  selection: string[]
  untested: string[]
  full: boolean
  reason: string
}

declare module 'claude-code' {
  interface PluginState {
    'test-impact': {
      impact: Shaped<ImpactStatus>
    }
  }
}
