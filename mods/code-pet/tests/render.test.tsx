import { expect, test } from 'claude-code/testing'

const SITE = {
  plugin: 'code-pet',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false },
} as const

test('the AbovePrompt draws in the shared design on terminal and desktop', async ($, on) => {
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...SITE, surface } as never)
    expect((await ui.find({ type: 'Text', text: /code-pet is/ }))?.text ?? '').toContain(
      'code-pet is',
    )
    await ui.unmount()
  }
})
