// trace: execution observability mod.
//
// A thin adapter over packages/core's ExecutionTrace contract. The store
// (InMemoryTrace) is bounded and pure; this file only wires host events to
// store mutations and renders /trace commands.
//
//   - session.start          -> reset the store, open the main agent node
//   - turn.start             -> (no-op; main node is the parent)
//   - agent.spawn            -> open an agent node under main
//   - tool.call              -> open a tool node under the current agent
//   - tool.result            -> close the tool node (completed/failed)
//   - turn.complete          -> close the main node's open children
//   - /trace                 -> full hierarchical tree
//   - /trace-summary         -> one-line counts
//
// Telemetry is in-memory only; nothing leaves the session.

import type { Register } from 'claude-code'
import { InMemoryTrace, renderTree } from '@agentic-mods/core'
import { openAgent, openTool, summarize, traceSpinnerSuffix, fileTouchFromTool } from './lib/summary'

const trace = new InMemoryTrace()
// Map of in-flight tool node ids keyed by a per-event correlation token. The
// host does not always hand us an id, so we key on the tool name + a counter
// and close the most recent open tool node for that tool on tool.result.
const openTools: string[] = []
let mainId = 'main'

/** Safely pull a string field out of an event whose shape is loosely typed. */
function strField(e: unknown, key: string): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export const register: Register = (on) => {
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
    void _$
    // An agent is spawned under the main agent (or its parent if provided).
    const parentId = strField(e, 'parentId') ?? mainId
    openAgent(trace, parentId, strField(e, 'subagentType'), strField(e, 'description'))
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('tool.call', async (_$, e, next) => {
    void _$
    const parentId = strField(e, 'parentId') ?? mainId
    const id = openTool(trace, parentId, strField(e, 'tool'), strField(e, 'command'))
    openTools.push(id)
    const touch = fileTouchFromTool(strField(e, 'tool'), strField(e, 'file_path'))
    if (touch) trace.touchFile(id, touch)
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('tool.result', async (_$, e, next) => {
    void _$
    // Close the most recently opened tool node. If the result carries a
    // deny/error we mark it failed; otherwise completed.
    const id = openTools.pop()
    if (id) {
      const failed = typeof e === 'object' && e !== null && 'error' in e
      trace.close(id, { status: failed ? 'failed' : 'completed', note: noteForResult(e) })
    }
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // Close any tool nodes still open at turn end (e.g. the host cancelled).
    while (openTools.length > 0) {
      const id = openTools.pop() as string
      trace.close(id, { status: 'cancelled', note: 'open at turn.complete' })
    }
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  // Live spinner suffix: running/total counts.
  on('ui.render', { component: 'Spinner' }, async (_$, e, next) => {
    void _$
    return next({ ...e, props: { ...e.props, suffix: traceSpinnerSuffix(summarize(trace)) } })
  })

  on('command.run', { command: 'trace' }, async () => {
    return { text: renderTree(trace.snapshot()) }
  })

  on('command.run', { command: 'trace-summary' }, async () => {
    const s = summarize(trace)
    return {
      text:
        `trace summary: ${s.total} nodes (${s.agents} agents, ${s.tools} tools) — ` +
        `${s.running} running, ${s.completed} completed, ${s.failed} failed, ${s.cancelled} cancelled; ` +
        `${s.filesTouched} file(s) touched`,
    }
  })

  // Helper to extract a short note from a tool result (deny reason, error).
  function noteForResult(e: unknown): string {
    if (typeof e !== 'object' || e === null) return ''
    const r = e as { deny?: string; error?: string; result?: unknown }
    if (typeof r.deny === 'string') return `denied: ${r.deny.slice(0, 80)}`
    if (typeof r.error === 'string') return `error: ${r.error.slice(0, 80)}`
    return ''
  }
}
