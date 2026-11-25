import { expect, test } from 'claude-code/testing'

const SITE = {
  plugin: 'engineering-cockpit',
  component: 'Pane',
  requestId: 'engineering-cockpit',
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
    expect((await ui.find({ type: 'Text', text: /Engineering cockpit/ }))?.text ?? '').toContain(
      'Engineering cockpit',
    )
    await ui.unmount()
  }
})
