export type TimelineEntry = {
  id: string
  at: number
  kind: 'command' | 'hypothesis' | 'result'
  text: string
  outcome: 'open' | 'confirmed' | 'rejected' | null
}

export type TimelineState = {
  entries: TimelineEntry[]
  repeated: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'debug-timeline': {
      timeline: Shaped<TimelineState>
    }
  }
}
