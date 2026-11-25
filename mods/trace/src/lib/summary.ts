// Pure helpers for the trace mod. The ExecutionTrace store itself lives in
// packages/core (so it is reusable by other runtimes); this file holds the
// event->store mapping helpers and the summary rendering used by /trace.
//
// No Claude Code imports here: the adapter passes raw event fields in, and
// these helpers decide which ExecutionTrace method to call.

import type { ExecutionTrace, FileTouch, NodeKind } from './trace'

/** Decide a tool node's label from the event. */
export function toolLabel(tool: string | undefined, command: string | undefined): string {
  const t = typeof tool === 'string' && tool.length > 0 ? tool : 'unknown'
  if (typeof command === 'string' && command.length > 0) {
    const head = command.split('\n')[0] ?? ''
    return `${t}: ${head.slice(0, 60)}`
  }
  return t
}

/** Map a file operation from a Write/Edit event into a FileTouch. */
export function fileTouchFromTool(
  tool: string | undefined,
  path: string | undefined,
): FileTouch | null {
  if (typeof path !== 'string' || path.length === 0) return null
  const op = tool === 'Edit' || tool === 'Write' ? 'write' : 'read'
  return { path, op }
}

/**
 * Summary statistics over a trace snapshot. Used by /trace-summary and the
 * spinner suffix (which shows a compact count of running nodes).
 */
export interface TraceSummary {
  total: number
  running: number
  completed: number
  failed: number
  cancelled: number
  agents: number
  tools: number
  filesTouched: number
}

export function summarize(trace: ExecutionTrace): TraceSummary {
  const snap = trace.snapshot()
  let running = 0
  let completed = 0
  let failed = 0
  let cancelled = 0
  let agents = 0
  let tools = 0
  const files = new Set<string>()
  for (const n of snap.nodes) {
    if (n.status === 'running') running += 1
    else if (n.status === 'completed') completed += 1
    else if (n.status === 'failed') failed += 1
    else if (n.status === 'cancelled') cancelled += 1
    if (n.kind === 'agent') agents += 1
    if (n.kind === 'tool') tools += 1
    for (const f of n.files) files.add(f.path)
  }
  return {
    total: snap.nodes.length,
    running,
    completed,
    failed,
    cancelled,
    agents,
    tools,
    filesTouched: files.size,
  }
}

/** A one-line spinner suffix: running count + totals. */
export function traceSpinnerSuffix(s: TraceSummary): string {
  return ` · trace: ${s.running} running / ${s.total} nodes (${s.agents} agents, ${s.tools} tools)`
}

/**
 * Adapter helper: record a tool.call opening against the trace. Returns the
 * new node id so the adapter can close it on tool.result.
 */
export function openTool(
  trace: ExecutionTrace,
  parentId: string,
  tool: string | undefined,
  command: string | undefined,
): string {
  return trace.open({ kind: 'tool' satisfies NodeKind, label: toolLabel(tool, command), parentId })
}

/** Adapter helper: open a subagent node from an agent.spawn event. */
export function openAgent(
  trace: ExecutionTrace,
  parentId: string,
  subagentType: string | undefined,
  description: string | undefined,
): string {
  const role = typeof subagentType === 'string' && subagentType.length > 0 ? subagentType : 'agent'
  const label =
    typeof description === 'string' && description.length > 0
      ? `${role}: ${description.slice(0, 50)}`
      : role
  return trace.open({ kind: 'agent' satisfies NodeKind, label, parentId })
}
