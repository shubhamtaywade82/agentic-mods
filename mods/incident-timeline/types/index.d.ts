export type IncidentState = {
  isOpen: boolean
  profile: 'standard' | 'strict'
  id: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'incident-timeline': {
      incident: Shaped<IncidentState>
    }
  }
}
