export type Orientation = {
  goal: string | null
  task: string | null
  blocker: string | null
  next: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'task-orientation': {
      orientation: Shaped<Orientation>
    }
  }
}
