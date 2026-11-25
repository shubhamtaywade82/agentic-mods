import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import {
  agentTree,
  type AgentNode,
  finishAgent,
  narrateAgent,
  recordToolCall,
  spawnAgent,
  registerCommand,
} from '@agentic-mods/core'
import { band, card, chip, empty, header, mark, statusLook } from '../../../packages/core/src/ui'
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
    await registerCommand($, {
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
      nodes = recordToolCall(
        nodes,
        e.agentId,
        'file_path' in e && typeof e.file_path === 'string' ? e.file_path : null,
      )
      const now = await $.clock.now()
      await update($, agents, () => rowsOf(now))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const rows = await read($, agents)
    if (rows.length === 0) {
      return empty(kit, 'No subagents have run in this session.', 'ask Claude to use a subagent')
    }
    const running = rows.filter((row) => row.status === 'running').length
    const files = filesByAgentCount(rows)
    return (
      <Box flexDirection="column">
        {header(kit, {
          title: 'Mission control',
          meta: `${rows.length} agent(s) · ${totalToolCalls()} tools`,
          badge: chip(kit, `${running} running`, statusLook(running > 0 ? 'running' : 'completed')),
        })}
        {rows.map((row) => (
          <Box key={row.id} marginLeft={row.depth * 2}>
            {card(kit, {
              key: `card-${row.id}`,
              title: `${row.isReview ? '[review] ' : ''}${row.subagentType}: ${row.description}`,
              look: statusLook(row.status),
              lines: [
                `${row.toolCalls} tool call(s) · ${row.files.length} file(s) · ${row.status}`,
                row.line,
              ],
            })}
          </Box>
        ))}
        {files.length === 0 ? null : (
          <Box flexDirection="column" marginTop={1}>
            <Text weight="bold">Code touched</Text>
            {files.map(([file, count]) =>
              mark(kit, `${file}  (${count} agent(s))`, statusLook('completed')),
            )}
          </Box>
        )}
      </Box>
    )
  })

  // A live line above the prompt while any subagent works; quiet otherwise.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = await read($, agents)
    const running = rows.filter((row) => row.status === 'running')
    const current = running[running.length - 1]
    if (current === undefined) return next(e)
    return band($.ui.resolve(e), 'mission', [
      { text: `${running.length}/${rows.length} agents`, tone: 'claude', bold: true },
      { text: `${totalToolCalls()} tools` },
      { text: `${current.subagentType}: ${current.description}`, tone: 'subtle' },
    ])
  })
}

/** Each touched file and how many agents touched it, most-shared first. */
function filesByAgentCount(rows: readonly AgentRow[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const row of rows)
    for (const file of new Set(row.files)) counts.set(file, (counts.get(file) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12)
}
