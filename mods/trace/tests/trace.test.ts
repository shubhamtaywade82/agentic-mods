// Unit tests for trace's pure lib + the packages/core ExecutionTrace it uses.

import { expect, test } from 'claude-code/testing'
import { InMemoryTrace, renderTree } from '../src/lib/trace'
import { fileTouchFromTool, summarize, traceSpinnerSuffix, toolLabel } from '../src/lib/summary'

// ------------------------------------------------------- InMemoryTrace core

test('InMemoryTrace builds a parent->child tree from parentId', () => {
  const t = new InMemoryTrace()
  const main = t.open({ kind: 'main', label: 'main', parentId: null })
  const a = t.open({ kind: 'agent', label: 'researcher', parentId: main })
  const tool = t.open({ kind: 'tool', label: 'Bash: ls', parentId: a })
  t.close(tool, { status: 'completed' })
  t.close(a, { status: 'completed' })
  const snap = t.snapshot()
  expect(snap.nodes).toHaveLength(3)
  expect(snap.edges).toHaveLength(2)
  expect(snap.nodes[0]?.id).toBe('main')
})

test('tool results bubble file touches up to the agent ancestor', () => {
  const t = new InMemoryTrace()
  const main = t.open({ kind: 'main', label: 'main', parentId: null })
  const a = t.open({ kind: 'agent', label: 'dev', parentId: main })
  const tool = t.open({ kind: 'tool', label: 'Write', parentId: a })
  t.touchFile(tool, { path: 'src/a.ts', op: 'write' })
  t.close(tool, { status: 'completed' })
  const agent = t.get(a)
  expect(agent?.files).toHaveLength(1)
  expect(agent?.files[0]?.path).toBe('src/a.ts')
  const mainNode = t.get(main)
  expect(mainNode?.files).toHaveLength(1) // bubbles to main too
})

test('the store is bounded: oldest leaf dropped past the cap', () => {
  const t = new InMemoryTrace(5)
  const main = t.open({ kind: 'main', label: 'main', parentId: null })
  for (let i = 0; i < 10; i += 1) {
    const id = t.open({ kind: 'tool', label: `t${i}`, parentId: main })
    t.close(id, { status: 'completed' })
  }
  expect(t.snapshot().nodes.length).toBeLessThanOrEqual(5)
  // main is never evicted
  expect(t.get('main')).not.toBeUndefined()
})

test('renderTree produces an indented tree string', () => {
  const t = new InMemoryTrace()
  const main = t.open({ kind: 'main', label: 'main', parentId: null })
  const a = t.open({ kind: 'agent', label: 'dev', parentId: main })
  t.open({ kind: 'tool', label: 'Read', parentId: a })
  const text = renderTree(t.snapshot())
  expect(text).toContain('main')
  expect(text).toContain('dev')
  expect(text).toContain('Read')
  expect(text.split('\n').length).toBeGreaterThanOrEqual(3)
})

test('renderTree handles an empty trace', () => {
  const t = new InMemoryTrace()
  expect(renderTree(t.snapshot())).toContain('empty')
})

// --------------------------------------------------------- summary helpers

test('toolLabel formats a tool + command head', () => {
  expect(toolLabel('Bash', 'ls -la\necho hi')).toBe('Bash: ls -la')
  expect(toolLabel('Read', undefined)).toBe('Read')
  expect(toolLabel(undefined, undefined)).toBe('unknown')
})

test('fileTouchFromTool maps Write/Edit to write, others to read', () => {
  expect(fileTouchFromTool('Write', 'a.ts')?.op).toBe('write')
  expect(fileTouchFromTool('Edit', 'a.ts')?.op).toBe('write')
  expect(fileTouchFromTool('Read', 'a.ts')?.op).toBe('read')
  expect(fileTouchFromTool('Read', undefined)).toBeNull()
})

test('summarize counts nodes, agents, tools and files', () => {
  const t = new InMemoryTrace()
  const main = t.open({ kind: 'main', label: 'main', parentId: null })
  t.open({ kind: 'agent', label: 'dev', parentId: main })
  const tool = t.open({ kind: 'tool', label: 'Write', parentId: main })
  t.touchFile(tool, { path: 'a.ts', op: 'write' })
  t.touchFile(tool, { path: 'b.ts', op: 'write' })
  const s = summarize(t)
  expect(s.total).toBe(3)
  expect(s.agents).toBe(1)
  expect(s.tools).toBe(1)
  expect(s.running).toBe(3)
  expect(s.filesTouched).toBe(2)
})

test('traceSpinnerSuffix packs the running/total counts into one line', () => {
  const t = new InMemoryTrace()
  t.open({ kind: 'main', label: 'main', parentId: null })
  const s = summarize(t)
  const line = traceSpinnerSuffix(s)
  expect(line).toContain('trace:')
  expect(line).toContain('running')
})
