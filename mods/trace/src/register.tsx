import type { On } from 'claude-code'
import { InMemoryTrace, renderTree } from './lib/trace'
import { openAgent, openTool, summarize, traceSpinnerSuffix, fileTouchFromTool } from './lib/summary'

const trace = new InMemoryTrace()
const openTools: string[] = []
let mainId = trace.open({ kind: 'main', label: 'main', parentId: null })

function strField(e: unknown, key: string): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trace',
      description: 'Show the hierarchical execution tree for this session',
    })
    await $.command.register({
      name: 'trace-summary',
      description: 'One-line summary of the execution tree (counts, running nodes)',
    })
    trace.reset()
    openTools.length = 0
    mainId = trace.open({ kind: 'main', label: 'main', parentId: null })
    return next(e)
  })

  on('agent.spawn', async (_$, e, next) => {
    const parentId = strField(e, 'parentId') ?? mainId
    openAgent(trace, parentId, strField(e, 'subagentType'), strField(e, 'description'))
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('tool.call', async (_$, e, next) => {
    const parentId = strField(e, 'parentId') ?? mainId
    const id = openTool(trace, parentId, strField(e, 'tool'), strField(e, 'command'))
    openTools.push(id)
    const touch = fileTouchFromTool(strField(e, 'tool'), strField(e, 'file_path'))
    if (touch) trace.touchFile(id, touch)
    try {
      const res = await next(e)
      const failed = typeof res === 'object' && res !== null && ('error' in res || 'deny' in res)
      trace.close(id, { status: failed ? 'failed' : 'completed' })
      return res
    } catch (err) {
      trace.close(id, { status: 'failed', note: String(err) })
      throw err
    }
  }).catch(async (_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    while (openTools.length > 0) {
      const id = openTools.pop() as string
      trace.close(id, { status: 'cancelled', note: 'open at turn.complete' })
    }
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('ui.render', { component: 'Spinner' }, async (_$, e, next) => {
    return next({ ...e, props: { ...e.props, suffix: traceSpinnerSuffix(summarize(trace)) } })
  })

  on('command.run', { command: 'trace' }, async () => {
    if (!trace.get('main')) {
      mainId = trace.open({ kind: 'main', label: 'main', parentId: null })
    }
    return { text: renderTree(trace.snapshot()) }
  })

  on('command.run', { command: 'trace-summary' }, async () => {
    const s = summarize(trace)
    return { text: `trace summary: ${s.total} nodes (${s.agents} agents, ${s.tools} tools; ${s.running} running, ${s.failed} failed, ${s.completed} completed)` }
  })
}
