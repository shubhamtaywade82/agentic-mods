export type Voice = 'sport' | 'monologue' | 'off'

declare module 'claude-code' {
  interface PluginState {
    commentary: {
      voice: Shaped<Voice>
      latest: Shaped<string>
    }
  }
}
