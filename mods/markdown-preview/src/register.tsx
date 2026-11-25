import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { isAbsolutePath, hasParentSegment, isProtectedPath, loadConfig, normalizePath } from '@agentic-mods/core'
import type { PreviewDocument } from '../types'

const PANE = 'markdown-preview'
const MAX_BYTES = 200_000
const IDLE: PreviewDocument = { path: '', text: '' }
const document = atom(
  { plugin: 'markdown-preview', key: 'document' } as const,
  IDLE,
  { shape: 'document-1' },
)

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'preview',
      description: 'Render a repository Markdown file in a pane: /preview <path>',
    })
    return next(e)
  })

  on('command.run', { command: 'preview' }, async ($, e) => {
    const path = normalizePath(e.args.trim())
    if (path === '' || isAbsolutePath(path) || hasParentSegment(path)) {
      return { text: 'Usage: /preview <relative path inside the repository>' }
    }
    const config = (await loadConfig(p => $.fs.read(p))).value.guard
    if (isProtectedPath(path, config.protectedPaths, config.protectedExceptions)) {
      return { text: `${path} is a protected secret file and is not rendered.` }
    }
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.size > MAX_BYTES) {
      return { text: `${path} is not a readable file under ${MAX_BYTES} bytes.` }
    }
    const text = await $.fs.read(path)
    await update($, document, () => ({ path, text }))
    await $.ui.open({ id: PANE, title: 'Preview' })
    return { text: `Previewing ${path}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, document)
    if (current.path === '') {
      return (
        <Box>
          <Text dimColor>Run /preview with a Markdown file path.</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text dimColor>{current.path}</Text>
        <Markdown key="document" text={current.text} />
      </Box>
    )
  })
}
