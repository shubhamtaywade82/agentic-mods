export type Steps = {
  texts: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      steps: Shaped<Steps>
    }
  }
}
