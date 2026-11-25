export type Mood = 'idle' | 'content' | 'busy' | 'worried'

declare module 'claude-code' {
  interface PluginState {
    'code-pet': {
      mood: Shaped<Mood>
    }
  }
}
