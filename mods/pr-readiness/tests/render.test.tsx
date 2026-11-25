import { expect, test } from 'claude-code/testing'

const SITE = {
  plugin: 'pr-readiness',
  component: 'Pane',
  requestId: 'pr-readiness',
  props: {
    title: 'Pane',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the Pane draws in the shared design on terminal and desktop', async ($, on) => {
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...SITE, surface } as never)
    expect((await ui.find({ type: 'Text', text: /PR readiness/ }))?.text ?? '').toContain(
      'PR readiness',
    )
    await ui.unmount()
  }
})
