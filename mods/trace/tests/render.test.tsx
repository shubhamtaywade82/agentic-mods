import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'trace',
  component: 'Pane',
  requestId: 'trace',
  props: {
    title: 'Trace',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the trace pane draws the tree with connectors on every surface', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: 'README.md' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Trace/ }))?.text).toContain('Trace')
    expect((await ui.find({ type: 'Text', text: /└─/ }))?.text).toContain('Read')
    await ui.unmount()
  }
})
