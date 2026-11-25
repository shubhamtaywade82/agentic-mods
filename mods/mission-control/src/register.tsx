import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import {
  agentTree,
  type AgentNode,
  finishAgent,
  narrateAgent,
  recordToolCall,
  spawnAgent,
} from '@agentic-mods/core'
import type { AgentRow } from '../types'

const PANE = 'mission-control'
const REVIEW_PATTERN = /review/i
const MAX_ROWS = 60

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, [] as AgentRow[], {
  shape: 'agents-1',
})

/** Agent records live in this module; only the drawn rows are published to state. */
let nodes: ReadonlyMap<string, AgentNode> = new Map()

function rowsOf(now: number): AgentRow[] {
  return agentTree(nodes)
    .slice(-MAX_ROWS)
    .map(({ node, depth }) => ({
      id: node.id,
      parentId: node.parentId,
      subagentType: node.subagentType,
      description: node.description,
      status: node.status,
      toolCalls: node.toolCalls,
      files: node.files,
      line: narrateAgent(node, now),
      isReview: REVIEW_PATTERN.test(node.subagentType) || REVIEW_PATTERN.test(node.description),
      depth,
    }))
}

function totalToolCalls(): number {
  let total = 0
  for (const node of nodes.values()) total += node.toolCalls
  return total
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'subagents',
      description: 'Show subagent activity in a pane (/subagents)',
    })
    return next(e)
  })

  on('command.run', { command: 'subagents' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Agents' })
    return { text: 'Agent activity pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId !== undefined) {
      const now = await $.clock.now()
      nodes = spawnAgent(nodes, {
        id: result.agentId,
        parentId: e.parentAgentId ?? null,
        subagentType: e.subagentType,
        description: e.description,
        at: now,
      })
      await update($, agents, () => rowsOf(now))
    }
    return result
  })

  on('agent.report', async ($, e, next) => {
    const ran = await next(e)
    const now = await $.clock.now()
    nodes = finishAgent(nodes, { id: e.agentId, status: e.status, report: e.text, at: now })
    await update($, agents, () => rowsOf(now))
    return ran
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      nodes = recordToolCall(nodes, e.agentId, null)
      const now = await $.clock.now()
      await update($, agents, () => rowsOf(now))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = await read($, agents)
    if (rows.length === 0) {
      return (
        <Box>
          <Text dimColor>No subagents have run in this session.</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {rows.map((row) => (
          <Text key={row.id} dimColor={row.status !== 'running'}>
            {'  '.repeat(row.depth)}
            {row.isReview ? '[review] ' : ''}
            {row.line}
          </Text>
        ))}
        <Text dimColor>{totalToolCalls()} subagent tool calls this session</Text>
      </Box>
    )
  })
}
