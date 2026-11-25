export type CockpitRow = {
  label: string
  verdict: 'PASS' | 'FAIL' | 'STALE' | 'UNKNOWN' | 'READY' | 'NOT READY'
  detail: string
}

declare module 'claude-code' {
  interface PluginState {
    'engineering-cockpit': {
      rows: Shaped<CockpitRow[]>
    }
  }
}
