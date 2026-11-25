/* Claims on files across sessions, and the tree of subagents built from agent events. */

export type Claim = {
  path: string
  sessionId: string
  owner: string
  at: number
}

export type ClaimResult = {
  claims: Claim[]
  conflict: Claim | null
}

/**
 * Records that a session is touching a path. Another session holding a fresh claim on the
 * same path is reported as a conflict and the claim is not taken over.
 */
export function claimPath(
  claims: readonly Claim[],
  claim: Claim,
  ttlMs: number,
  now: number,
): ClaimResult {
  const fresh = pruneClaims(claims, ttlMs, now)
  const holder = fresh.find(
    (existing) => existing.path === claim.path && existing.sessionId !== claim.sessionId,
  )
  if (holder !== undefined) return { claims: fresh, conflict: holder }
  const others = fresh.filter(
    (existing) => !(existing.path === claim.path && existing.sessionId === claim.sessionId),
  )
  return { claims: [...others, { ...claim, at: now }], conflict: null }
}

export function pruneClaims(claims: readonly Claim[], ttlMs: number, now: number): Claim[] {
  return claims.filter((claim) => now - claim.at <= ttlMs)
}

export type AgentStatus = 'running' | 'completed' | 'failed' | 'stopped'

export type AgentNode = {
  id: string
  parentId: string | null
  subagentType: string
  description: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  toolCalls: number
  files: string[]
  report: string
}

export function spawnAgent(
  nodes: ReadonlyMap<string, AgentNode>,
  input: {
    id: string
    parentId: string | null
    subagentType: string
    description: string
    at: number
  },
): Map<string, AgentNode> {
  const next = new Map(nodes)
  next.set(input.id, {
    id: input.id,
    parentId: input.parentId,
    subagentType: input.subagentType,
    description: input.description,
    status: 'running',
    startedAt: input.at,
    endedAt: null,
    toolCalls: 0,
    files: [],
    report: '',
  })
  return next
}

export function recordToolCall(
  nodes: ReadonlyMap<string, AgentNode>,
  id: string,
  file: string | null,
): Map<string, AgentNode> {
  const node = nodes.get(id)
  if (node === undefined) return new Map(nodes)
  const files =
    file !== null && !node.files.includes(file) ? [...node.files, file].slice(-50) : node.files
  const next = new Map(nodes)
  next.set(id, { ...node, toolCalls: node.toolCalls + 1, files })
  return next
}

export function finishAgent(
  nodes: ReadonlyMap<string, AgentNode>,
  input: { id: string; status: Exclude<AgentStatus, 'running'>; report: string; at: number },
): Map<string, AgentNode> {
  const node = nodes.get(input.id)
  const next = new Map(nodes)
  if (node === undefined) return next
  next.set(input.id, {
    ...node,
    status: input.status,
    endedAt: input.at,
    report: input.report.slice(0, 500),
  })
  return next
}

/** A plain-language line about one agent. Templated from events: no model call. */
export function narrateAgent(node: AgentNode, now: number): string {
  const seconds = Math.round(((node.endedAt ?? now) - node.startedAt) / 1000)
  const files =
    node.files.length === 0 ? 'no files touched' : `touched ${node.files.length} file(s)`
  const verb =
    node.status === 'running'
      ? 'is working on'
      : node.status === 'completed'
        ? 'finished'
        : node.status === 'failed'
          ? 'failed on'
          : 'was stopped during'
  return `${node.subagentType} ${verb} "${node.description}" for ${seconds}s, ${node.toolCalls} tool call(s), ${files}.`
}

/** Children of each agent, roots first, in start order. */
export function agentTree(
  nodes: ReadonlyMap<string, AgentNode>,
): Array<{ node: AgentNode; depth: number }> {
  const children = new Map<string | null, AgentNode[]>()
  for (const node of nodes.values()) {
    const key = nodes.has(node.parentId ?? '') ? node.parentId : null
    const list = children.get(key) ?? []
    list.push(node)
    children.set(key, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.startedAt - b.startedAt)
  const out: Array<{ node: AgentNode; depth: number }> = []
  const visit = (parent: string | null, depth: number): void => {
    for (const node of children.get(parent) ?? []) {
      out.push({ node, depth })
      visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return out
}
