import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  type Budget,
  type BenchmarkFormat,
  evaluateBudgets,
  parseMetrics,
  normalizePath,
  worstVerdict,
} from '@agentic-mods/core'
import type { BudgetStatus } from '../types'

const FORMATS: readonly BenchmarkFormat[] = ['generic', 'vite-stats', 'jmh', 'pytest-benchmark', 'go-bench']
const IDLE: BudgetStatus = { verdict: 'UNKNOWN', rows: ['no measurement checked yet'] }
const status = atom({ plugin: 'performance-budget', key: 'status' } as const, IDLE, { shape: 'status-1' })

async function budgetsOf($: EngineInterface): Promise<Budget[]> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read('.agentic-mods/budgets.json'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Budget =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Budget).name === 'string' &&
        typeof (item as Budget).max === 'number' &&
        typeof (item as Budget).unit === 'string',
    )
  } catch {
    return []
  }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'perf',
      description: 'Check a measurement against budgets: /perf check <generic|vite-stats|jmh|pytest-benchmark|go-bench> <path>',
    })
    return next(e)
  })

  on('command.run', { command: 'perf' }, async ($, e) => {
    const [subcommand = '', format = '', ...rest] = e.args.trim().split(/\s+/)
    const chosen = FORMATS.find(value => value === format)
    if (subcommand !== 'check' || chosen === undefined || rest.length === 0) {
      return { text: `Usage: /perf check <${FORMATS.join('|')}> <path>` }
    }
    const path = normalizePath(rest.join(' '))
    const budgets = await budgetsOf($)
    if (budgets.length === 0) {
      return { text: 'No budgets: add .agentic-mods/budgets.json as a list of {name, max, unit}.' }
    }
    const metrics = parseMetrics(chosen, await $.fs.read(path))
    const rows = evaluateBudgets(metrics, budgets)
    const verdict = worstVerdict(rows.map(row => row.verdict))
    const lines = rows.map(row => {
      const value = row.value === null ? 'missing' : `${row.value} ${row.unit}`
      return `${row.name}: ${row.verdict} (${value}, budget ${row.max} ${row.unit}, ${row.reason})`
    })
    await update($, status, () => ({ verdict, rows: lines }))
    return { text: lines.join('\n') }
  })
}
