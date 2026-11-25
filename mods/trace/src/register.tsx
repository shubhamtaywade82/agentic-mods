import type { On } from 'claude-code'
import { InMemoryTrace, renderTree } from './lib/trace'
import {
  openAgent,
  openTool,
  summarize,
  traceSpinnerSuffix,
  fileTouchFromTool,
} from './lib/summary'
import { registerCommand } from '@agentic-mods/core'

const trace = new InMemoryTrace()
const openTools = new Set<string>()
// Subagent id (from agent.spawn's result) -> its trace node.
const agentNodes = new Map<string, string>()
let mainId = trace.open({ kind: 'main', label: 'main', parentId: null })

function strField(e: unknown, key: string): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'trace-tree',
      description: 'Show the hierarchical execution tree for this session',
    })
    await registerCommand($, {
      name: 'trace-summary',
      description: 'One-line summary of the execution tree (counts, running nodes)',
    })
    trace.reset()
    openTools.clear()
    agentNodes.clear()
    mainId = trace.open({ kind: 'main', label: 'main', parentId: null })
    return next(e)
  })

  on('agent.spawn', async (_$, e, next) => {
    const parentId = agentNodes.get(strField(e, 'parentAgentId') ?? '') ?? mainId
    const id = openAgent(trace, parentId, strField(e, 'subagentType'), strField(e, 'description'))
    const res = await next(e)
    const agentId = strField(res, 'agentId')
    if (agentId) agentNodes.set(agentId, id)
    else trace.close(id, { status: 'failed', note: strField(res, 'deny') ?? 'not started' })
    return res
  })

  on('tool.call', async (_$, e, next) => {
    const parentId = agentNodes.get(strField(e, 'agentId') ?? '') ?? mainId
    const id = openTool(trace, parentId, strField(e, 'tool'), strField(e, 'command'))
    openTools.add(id)
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
    } finally {
      openTools.delete(id)
    }
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = strField(e, 'agentId')
    const agentNode = agentNodes.get(agentId ?? '')
    if (agentNode) {
      trace.close(agentNode, { status: 'completed' })
      agentNodes.delete(agentId as string)
    } else {
      for (const id of openTools)
        trace.close(id, { status: 'cancelled', note: 'open at turn.complete' })
      openTools.clear()
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async (_$, e, next) => {
    return next({ ...e, props: { ...e.props, suffix: traceSpinnerSuffix(summarize(trace)) } })
  })

  on('command.run', { command: 'trace-tree' }, async () => {
    if (!trace.get('main')) {
      mainId = trace.open({ kind: 'main', label: 'main', parentId: null })
    }
    return { text: renderTree(trace.snapshot()) }
  })

  on('command.run', { command: 'trace-summary' }, async () => {
    const s = summarize(trace)
    return {
      text: `trace summary: ${s.total} nodes (${s.agents} agents, ${s.tools} tools; ${s.running} running, ${s.failed} failed, ${s.completed} completed)`,
    }
  })
}
