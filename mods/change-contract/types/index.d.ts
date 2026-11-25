export type ContractStatus = {
  active: boolean
  objective: string
  violations: number
  mode: 'observe' | 'warn' | 'enforce'
}

declare module 'claude-code' {
  interface PluginState {
    'change-contract': {
      status: Shaped<ContractStatus>
    }
  }
}
