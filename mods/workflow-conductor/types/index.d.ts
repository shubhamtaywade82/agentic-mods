export type ConductorState = {
  active: boolean
  workflow: string
  task: string
  stage: string
  status: 'active' | 'completed' | 'cancelled' | 'none'
  blockers: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'workflow-conductor': {
      conductor: Shaped<ConductorState>
    }
  }
}
