import { expect, test } from 'claude-code/testing'

const SITE = {
  plugin: 'review-tracker',
  component: 'Pane',
  requestId: 'review-tracker',
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
    expect((await ui.find({ type: 'Text', text: /Review findings/ }))?.text ?? '').toContain(
      'Review findings',
    )
    await ui.unmount()
  }
})
