export type BudgetStatus = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  rows: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'performance-budget': {
      status: Shaped<BudgetStatus>
    }
  }
}
