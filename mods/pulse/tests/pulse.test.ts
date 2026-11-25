// Unit tests for pulse's pure lib. Run by `claude plugin test`.

import { expect, test } from 'claude-code/testing'
import { ToolStats, contextLine, pressureBand, report, spinnerSuffix } from '../hooks/lib/stats'

// ------------------------------------------------------------------ stats

test('ToolStats counts attempts per tool, sorted by count', () => {
  const s = new ToolStats()
  s.record('Bash')
  s.record('Read')
  s.record('Bash')
  const snap = s.snapshot()
  expect(snap.attempts).toBe(3)
  expect(snap.perTool).toEqual([
    { tool: 'Bash', count: 2 },
    { tool: 'Read', count: 1 },
  ])
})

test('ToolStats caps distinct tools but keeps the total exact', () => {
  const s = new ToolStats(2)
  s.record('A')
  s.record('B')
  s.record('C') // over the cap: counted in total, not itemized
  s.record('A')
  const snap = s.snapshot()
  expect(snap.attempts).toBe(4)
  expect(snap.perTool).toEqual([
    { tool: 'A', count: 2 },
    { tool: 'B', count: 1 },
  ])
})

test('ToolStats reset clears everything', () => {
  const s = new ToolStats()
  s.record('Bash')
  s.reset()
  expect(s.snapshot()).toEqual({ attempts: 0, perTool: [] })
})

test('ties in perTool are broken alphabetically for stable output', () => {
  const s = new ToolStats()
  s.record('Write')
  s.record('Read')
  expect(s.snapshot().perTool.map((p) => p.tool)).toEqual(['Read', 'Write'])
})

// --------------------------------------------------------------- pressure

test('pressure bands map to the right thresholds', () => {
  expect(pressureBand(0.1)).toBe('ok')
  expect(pressureBand(0.5)).toBe('caution')
  expect(pressureBand(0.75)).toBe('high')
  expect(pressureBand(0.9)).toBe('critical')
  expect(pressureBand(Number.NaN)).toBe('ok')
})

test('contextLine renders tokens, percent and band; safe on bad input', () => {
  expect(contextLine(50000, 200000)).toBe('context 50000/200000 (25%, ok)')
  expect(contextLine(170000, 200000)).toBe('context 170000/200000 (85%, high)')
  expect(contextLine(Number.NaN, 0)).toBe('context 0/0 (0%, ok)')
})

// ------------------------------------------------------ rendering helpers

test('spinnerSuffix packs attempts and context into one short line', () => {
  expect(spinnerSuffix(7, 100000, 200000)).toBe(' · pulse: 7 calls, context 100000/200000 (50%, caution)')
})

test('report lists tools with padded columns and the context line', () => {
  const s = new ToolStats()
  s.record('Bash')
  s.record('Bash')
  s.record('Read')
  const text = report(s.snapshot(), 1000, 4000)
  expect(text).toContain('tool-call attempts: 3')
  expect(text).toContain('context 1000/4000 (25%, ok)')
  expect(text).toContain('Bash')
  expect(text).toContain('Read')
})

test('report handles an empty session gracefully', () => {
  const text = report({ attempts: 0, perTool: [] }, 0, 0)
  expect(text).toContain('per tool: (none yet)')
})
