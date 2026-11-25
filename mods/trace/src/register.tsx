import type { On } from 'claude-code'
import { InMemoryTrace, durationLabel, renderTree, treeLines } from './lib/trace'
import { chip, empty, header, statusLook } from '../../../packages/core/src/ui'
import {
  openAgent,
  openTool,
  summarize,
  traceSpinnerSuffix,
  fileTouchFromTool,
} from './lib/summary'
import { registerCommand } from '@agentic-mods/core'

const PANE = 'trace'
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

  on('tool.call', async ($, e, next) => {
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
      $.ui.invalidate('ui.render')
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

  on('command.run', { command: 'trace-tree' }, async ($) => {
    if (!trace.get('main')) {
      mainId = trace.open({ kind: 'main', label: 'main', parentId: null })
    }
    await $.ui.open({ id: PANE, title: 'Trace' }).catch(() => undefined)
    return { text: renderTree(trace.snapshot()) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const lines = treeLines(trace.snapshot())
    if (lines.length === 0)
      return empty(kit, 'Nothing has run yet.', 'work in the session, then /trace-tree')
    const s = summarize(trace)
    return (
      <Box flexDirection="column">
        {header(kit, {
          title: 'Trace',
          meta: `${s.agents} agent(s) · ${s.tools} tool(s)`,
          badge:
            s.failed > 0
              ? chip(kit, `${s.failed} failed`, statusLook('failed'))
              : chip(
                  kit,
                  `${s.running} running`,
                  statusLook(s.running > 0 ? 'running' : 'completed'),
                ),
        })}
        {lines.map(({ prefix, node }) => {
          const look = statusLook(node.status)
          return (
            <Box key={node.id} flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">
                <Text dimColor>{prefix}</Text>
                <Text color={look.tone}>{look.glyph} </Text>
                <Text weight={node.kind === 'tool' ? 'regular' : 'bold'}>{node.label}</Text>
                {node.files.length > 0 ? (
                  <Text dimColor>{`  ${node.files.length} file(s)`}</Text>
                ) : null}
              </Text>
              <Text dimColor>{durationLabel(node)}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('command.run', { command: 'trace-summary' }, async () => {
    const s = summarize(trace)
    return {
      text: `trace summary: ${s.total} nodes (${s.agents} agents, ${s.tools} tools; ${s.running} running, ${s.failed} failed, ${s.completed} completed)`,
    }
  })
}
