export type MigrationStatus = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  findings: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'migration-sentinel': {
      status: Shaped<MigrationStatus>
    }
  }
}
