export type ReplayLine = {
  kind: 'equal' | 'insert' | 'delete'
  line: string
}

export type ReplayChange = {
  id: number
  turn: number
  file: string
  added: number
  removed: number
  lines: ReplayLine[]
}

export type ReplayState = {
  turn: number
  changes: ReplayChange[]
}

declare module 'claude-code' {
  interface PluginState {
    'turn-replay': {
      replay: Shaped<ReplayState>
      cursor: Shaped<number>
    }
  }
}
