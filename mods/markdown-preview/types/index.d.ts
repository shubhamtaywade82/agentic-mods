export type PreviewDocument = {
  path: string
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'markdown-preview': {
      document: Shaped<PreviewDocument>
    }
  }
}
