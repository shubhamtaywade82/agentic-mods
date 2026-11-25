import { type Verdict } from './policy'

export type Metric = {
  name: string
  value: number
  unit: string
}

export type Budget = {
  name: string
  max: number
  unit: string
}

export type BudgetRow = {
  name: string
  value: number | null
  max: number
  unit: string
  verdict: Verdict
  reason: string
}

export type BenchmarkFormat = 'generic' | 'vite-stats' | 'jmh' | 'pytest-benchmark' | 'go-bench'

/** Parses one benchmark or bundle report. Unknown shapes produce no metrics, never a guess. */
export function parseMetrics(format: BenchmarkFormat, text: string): Metric[] {
  if (format === 'go-bench') return parseGoBench(text)
  const parsed: unknown = JSON.parse(text)
  switch (format) {
    case 'generic':
      return parseGeneric(parsed)
    case 'vite-stats':
      return parseStats(parsed)
    case 'jmh':
      return parseJmh(parsed)
    case 'pytest-benchmark':
      return parsePytest(parsed)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseGeneric(parsed: unknown): Metric[] {
  const list = Array.isArray(parsed) ? parsed : asRecord(parsed)?.['metrics']
  if (!Array.isArray(list)) return []
  const out: Metric[] = []
  for (const item of list) {
    const record = asRecord(item)
    if (
      record === null ||
      typeof record['name'] !== 'string' ||
      typeof record['value'] !== 'number' ||
      !Number.isFinite(record['value'])
    ) {
      continue
    }
    out.push({
      name: record['name'],
      value: record['value'],
      unit: typeof record['unit'] === 'string' ? record['unit'] : '',
    })
  }
  return out
}

function parseStats(parsed: unknown): Metric[] {
  const assets = asRecord(parsed)?.['assets']
  if (!Array.isArray(assets)) return []
  let total = 0
  for (const asset of assets) {
    const record = asRecord(asset)
    if (record === null || typeof record['size'] !== 'number') continue
    const name = typeof record['name'] === 'string' ? record['name'] : ''
    if (/\.(js|mjs|css)$/.test(name)) total += record['size']
  }
  return [{ name: 'bundle-total', value: total, unit: 'bytes' }]
}

function parseJmh(parsed: unknown): Metric[] {
  if (!Array.isArray(parsed)) return []
  const out: Metric[] = []
  for (const item of parsed) {
    const record = asRecord(item)
    const primary = asRecord(record?.['primaryMetric'])
    if (
      record === null ||
      primary === null ||
      typeof record['benchmark'] !== 'string' ||
      typeof primary['score'] !== 'number'
    ) {
      continue
    }
    out.push({
      name: record['benchmark'],
      value: primary['score'],
      unit: typeof primary['scoreUnit'] === 'string' ? primary['scoreUnit'] : '',
    })
  }
  return out
}

function parsePytest(parsed: unknown): Metric[] {
  const benchmarks = asRecord(parsed)?.['benchmarks']
  if (!Array.isArray(benchmarks)) return []
  const out: Metric[] = []
  for (const item of benchmarks) {
    const record = asRecord(item)
    const stats = asRecord(record?.['stats'])
    if (record === null || stats === null || typeof record['name'] !== 'string') continue
    if (typeof stats['mean'] !== 'number') continue
    out.push({ name: record['name'], value: stats['mean'], unit: 's' })
  }
  return out
}

function parseGoBench(text: string): Metric[] {
  const out: Metric[] = []
  for (const line of text.split('\n')) {
    const match = /^(Benchmark\S+?)(?:-\d+)?\s+\d+\s+([\d.]+)\s+ns\/op/.exec(line.trim())
    if (match === null) continue
    out.push({ name: match[1] ?? '', value: Number(match[2]), unit: 'ns/op' })
  }
  return out
}

/**
 * Compares measurements with budgets. A budget with no measurement is UNKNOWN. A unit mismatch
 * is UNKNOWN too. A value above its maximum is FAIL. Otherwise PASS.
 */
export function evaluateBudgets(metrics: readonly Metric[], budgets: readonly Budget[]): BudgetRow[] {
  return budgets.map(budget => {
    const metric = metrics.find(candidate => candidate.name === budget.name)
    if (metric === undefined) {
      return {
        name: budget.name,
        value: null,
        max: budget.max,
        unit: budget.unit,
        verdict: 'UNKNOWN',
        reason: 'no measurement',
      }
    }
    if (metric.unit !== budget.unit) {
      return {
        name: budget.name,
        value: metric.value,
        max: budget.max,
        unit: budget.unit,
        verdict: 'UNKNOWN',
        reason: `unit ${metric.unit || 'none'} does not match ${budget.unit}`,
      }
    }
    const within = metric.value <= budget.max
    return {
      name: budget.name,
      value: metric.value,
      max: budget.max,
      unit: budget.unit,
      verdict: within ? 'PASS' : 'FAIL',
      reason: within ? 'within budget' : 'over budget',
    }
  })
}
