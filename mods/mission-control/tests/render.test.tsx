import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mission-control',
  component: 'Pane',
  requestId: 'mission-control',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane shows a card per subagent on every surface', async ($, on) => {
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'sonnet' }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({
    prompt: 'list src',
    description: 'List files in src',
    subagentType: 'Explore',
  } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/add.js', agentId: 'a1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Mission control/ }))?.text).toContain(
      'Mission control',
    )
    expect((await ui.find({ type: 'Text', text: /Explore: List files in src/ }))?.text).toContain(
      'Explore',
    )
    expect((await ui.find({ type: 'Text', text: /src\/add\.js/ }))?.text).toContain('1 agent')
    await ui.unmount()
  }
})

test('the pane says how to start when no subagent has run', async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No subagents/ }))?.text).toContain('No subagents')
  await ui.unmount()
})

test('a band above the prompt shows while a subagent runs', async ($, on) => {
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'sonnet' }))
  await $.agent.spawn({ prompt: 'p', description: 'Audit login', subagentType: 'Explore' } as never)

  const ui = await $.ui.mount({
    plugin: 'mission-control',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false },
  } as never)
  expect((await ui.find({ type: 'Text', text: /1\/1 agents/ }))?.text).toContain('1/1 agents')
  await ui.unmount()
})
