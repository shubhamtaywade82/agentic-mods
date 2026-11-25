import type { EngineInterface, On } from 'claude-code'

import { formatDuration } from '@agentic-mods/core'

const COUNTERS = ['turns', 'tools', 'edits'] as const

async function counter(
  $: Parameters<On>[0] extends never ? never : EngineInterface,
  key: string,
): Promise<number> {
  return Number((await $.store.get(key)) ?? 0)
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    // $.store outlives the session and a hot reload re-runs session.start, so reset only when the
    // session id changes.
    const sessionId = await $.session.id()
    if ((await $.store.get('sessionId')) !== sessionId) {
      await $.store.set('sessionId', sessionId)
      await $.store.set('startedAt', await $.clock.now())
      for (const key of COUNTERS) await $.store.set(key, 0)
    }
    await $.command.register({
      name: 'wrapped',
      description: 'Summarise this session: turns, tool calls, edits',
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await $.store.set('turns', (await counter($, 'turns')) + 1)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await $.store.set('tools', (await counter($, 'tools')) + 1)
    if (e.tool === 'Edit' || e.tool === 'Write') {
      await $.store.set('edits', (await counter($, 'edits')) + 1)
    }
    return next(e)
  })

  on('command.run', { command: 'wrapped' }, async ($) => {
    const startedAt = Number((await $.store.get('startedAt')) ?? (await $.clock.now()))
    const elapsed = formatDuration((await $.clock.now()) - startedAt)
    const values = await Promise.all(COUNTERS.map((key) => counter($, key)))
    const [turns = 0, tools = 0, edits = 0] = values
    return {
      text: `This session: ${elapsed} · ${turns} turn(s) · ${tools} tool call(s) · ${edits} file edit(s).`,
    }
  })
}
