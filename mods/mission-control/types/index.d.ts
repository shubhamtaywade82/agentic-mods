export type AgentRow = {
  id: string
  parentId: string | null
  subagentType: string
  description: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  toolCalls: number
  files: string[]
  line: string
  isReview: boolean
  depth: number
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      agents: Shaped<AgentRow[]>
    }
  }
}
