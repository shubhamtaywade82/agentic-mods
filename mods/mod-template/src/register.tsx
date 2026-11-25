import type { On } from 'claude-code'
import { AttemptCounter, LABELS } from './lib/counter'
import { formatUsage } from './lib/usage'

const counter = new AttemptCounter()

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mod-template-tally',
      description: 'Show how many tool-call attempts Claude has made',
    })
    await $.command.register({
      name: 'mod-template-usage',
      description: 'Show context and plan-limit usage',
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    counter.increment()
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async () => undefined)

  on('command.run', { command: 'mod-template-tally' }, async () => {
    return { text: LABELS.tally(counter.value) }
  })

  on('command.run', { command: 'mod-template-usage' }, async ($) => {
    const u = await $.session.usage()
    return { text: formatUsage(u as unknown as Parameters<typeof formatUsage>[0]) }
  })

  on('ui.render', { component: 'Spinner' }, async (_$, e, next) => {
    return next({
      ...e,
      props: { ...e.props, suffix: ` · ${LABELS.counter}: ${counter.value}…` },
    })
  })
}
