// Execution trace contracts for the agentic-mods SDK.
//
// A bounded, hierarchical record of what happened during an agentic run:
// main agent -> subagents -> tool calls, with parent/child links, per-node
// status, and files touched. Inspired by Mission Control, but extracted as a
// pure data + store contract independent of Claude Code's reactive UI layer,
// so any runtime can feed it and any UI can render it.
//
// State is BOUNDED: the store caps the number of tracked nodes (default 500)
// and drops the oldest leaf-first, mirroring the "cap history, don't retain
// unlimited" design rule from the reference analysis.

/** Status of a node in the execution tree. */
export type NodeStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** Kind of node: the root main agent, a spawned subagent, or a tool call. */
export type NodeKind = 'main' | 'agent' | 'tool'

/** A file the node is known to have read or written. */
export interface FileTouch {
  readonly path: string
  readonly op: 'read' | 'write' | 'delete'
}

/** A node in the execution tree. */
export interface TraceNode {
  /** Stable id; main agent is always 'main'. */
  readonly id: string
  readonly kind: NodeKind
  /** Parent id; the main agent has no parent. */
  readonly parentId: string | null
  /** Tool name for tool nodes, agent role for agent nodes. */
  readonly label: string
  status: NodeStatus
  /** Wall-clock ms, filled when the node completes. */
  durationMs: number
  /** Files this node touched (agents aggregate their children's touches). */
  files: FileTouch[]
  /** Free-form detail (denial reason, error message, etc.). */
  note: string
  /** When the node started, for ordering and TTL. */
  startedAt: number
}

/** A point-in-time snapshot of the trace, safe to render or serialize. */
export interface TraceSnapshot {
  readonly nodes: readonly TraceNode[]
  readonly edges: ReadonlyArray<{ from: string; to: string }>
}

/**
 * Bounded store of TraceNodes. The host adapter pushes events as they arrive;
 * readers (commands, UIs) pull snapshots. All mutation goes through `update`
 * so a future host-backed reactive layer can observe it.
 */
export interface ExecutionTrace {
  /** Open a new node under `parentId` (or root when null). Returns its id. */
  open(input: { kind: NodeKind; label: string; parentId?: string | null }): string
  /** Mark a node complete, failed, or cancelled and record duration + note. */
  close(id: string, close: { status: NodeStatus; note?: string; durationMs?: number }): void
  /** Attach a file touch to a node (and bubble to its agent ancestor). */
  touchFile(id: string, touch: FileTouch): void
  /** Read a defensive snapshot. */
  snapshot(): TraceSnapshot
  /** Look up a single node by id. */
  get(id: string): TraceNode | undefined
  /** Reset the store (e.g. on session start). */
  reset(): void
}

/** Default cap; older leaves are dropped past this to bound memory. */
export const DEFAULT_MAX_NODES = 500

/**
 * In-memory reference implementation of ExecutionTrace. Pure TypeScript, no
 * host imports. Nodes are kept in insertion order; the tree is reconstructed
 * from `parentId` on snapshot so the store stays a flat list.
 */
export class InMemoryTrace implements ExecutionTrace {
  private readonly nodes = new Map<string, TraceNode>()
  private order: string[] = []
  private readonly maxNodes: number
  private seq = 0

  constructor(maxNodes = DEFAULT_MAX_NODES) {
    this.maxNodes = maxNodes
  }

  open(input: { kind: NodeKind; label: string; parentId?: string | null }): string {
    const id = input.kind === 'main' ? 'main' : `n${(this.seq += 1)}`
    const node: TraceNode = {
      id,
      kind: input.kind,
      parentId: input.parentId ?? null,
      label: input.label,
      status: 'running',
      durationMs: 0,
      files: [],
      note: '',
      startedAt: Date.now(),
    }
    this.nodes.set(id, node)
    this.order.push(id)
    this.evict()
    return id
  }

  close(id: string, close: { status: NodeStatus; note?: string; durationMs?: number }): void {
    const n = this.nodes.get(id)
    if (!n || n.status !== 'running') return
    n.status = close.status
    if (close.note !== undefined) n.note = close.note
    n.durationMs = close.durationMs ?? Date.now() - n.startedAt
  }

  touchFile(id: string, touch: FileTouch): void {
    const n = this.nodes.get(id)
    if (!n) return
    n.files = [...n.files, touch]
    // Bubble up to the nearest agent ancestor (the main agent counts).
    let parentId = n.parentId
    while (parentId) {
      const p = this.nodes.get(parentId)
      if (!p) break
      p.files = [...p.files, touch]
      parentId = p.parentId
    }
  }

  snapshot(): TraceSnapshot {
    const nodes = this.order.map((id) => this.nodes.get(id)).filter((n): n is TraceNode => !!n)
    const edges = nodes
      .filter((n) => n.parentId !== null)
      .map((n) => ({ from: n.parentId as string, to: n.id }))
    return { nodes, edges }
  }

  get(id: string): TraceNode | undefined {
    return this.nodes.get(id)
  }

  reset(): void {
    this.nodes.clear()
    this.order = []
    this.seq = 0
  }

  /** Drop oldest leaf-first once we exceed the cap. Never evicts the main node. */
  private evict(): void {
    while (this.order.length > this.maxNodes) {
      const victimId = this.order.find((id) => id !== 'main' && !this.hasChildren(id))
      if (!victimId) break
      const idx = this.order.indexOf(victimId)
      this.order.splice(idx, 1)
      this.nodes.delete(victimId)
    }
  }

  private hasChildren(id: string): boolean {
    for (const n of this.nodes.values()) if (n.parentId === id) return true
    return false
  }
}

/** Render a trace snapshot as an indented tree string (for /trace commands). */
export function renderTree(snap: TraceSnapshot): string {
  if (snap.nodes.length === 0) return 'trace: (empty)'
  const byParent = new Map<string | null, TraceNode[]>()
  for (const n of snap.nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const lines: string[] = ['trace:']
  const render = (parentId: string | null, depth: number): void => {
    const children = byParent.get(parentId) ?? []
    for (const c of children) {
      const indent = '  '.repeat(depth)
      const icon = iconFor(c.status)
      const files = c.files.length > 0 ? ` · ${c.files.length} file(s)` : ''
      const note = c.note ? ` — ${c.note}` : ''
      lines.push(
        `${indent}${icon} ${c.label} [${c.status}${c.durationMs ? ` ${c.durationMs}ms` : ''}]${files}${note}`,
      )
      render(c.id, depth + 1)
    }
  }
  render(null, 0)
  return lines.join('\n')
}

function iconFor(status: NodeStatus): string {
  switch (status) {
    case 'running':
      return '▸'
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    case 'cancelled':
      return '·'
  }
}
