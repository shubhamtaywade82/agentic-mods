/** Line-level diff with Myers' O(ND) algorithm. */

export type DiffOp = {
  kind: 'equal' | 'insert' | 'delete'
  line: string
}

/** Above this many lines in both files combined, a coarse replacement is returned instead. */
const MAX_LINES = 20_000

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  if (a.length + b.length > MAX_LINES) {
    return [
      ...a.map((line) => ({ kind: 'delete' as const, line })),
      ...b.map((line) => ({ kind: 'insert' as const, line })),
    ]
  }
  return myers(a, b)
}

function myers(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  const max = n + m
  if (max === 0) return []
  const offset = max
  const v = new Int32Array(2 * max + 2)
  v[offset + 1] = 0
  const trace: Int32Array[] = []

  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0
      } else {
        x = (v[offset + k - 1] ?? 0) + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }

  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const prior = trace[d] ?? new Int32Array(0)
    const k = x - y
    const fromAbove =
      k === -d || (k !== d && (prior[offset + k - 1] ?? 0) < (prior[offset + k + 1] ?? 0))
    const prevK = fromAbove ? k + 1 : k - 1
    const prevX = prior[offset + prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'equal', line: a[x - 1] ?? '' })
      x--
      y--
    }
    if (d > 0) {
      if (fromAbove) {
        ops.push({ kind: 'insert', line: b[y - 1] ?? '' })
      } else {
        ops.push({ kind: 'delete', line: a[x - 1] ?? '' })
      }
    }
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

export type DiffSummary = { added: number; removed: number }

export function summarizeDiff(ops: readonly DiffOp[]): DiffSummary {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.kind === 'insert') added++
    else if (op.kind === 'delete') removed++
  }
  return { added, removed }
}

/**
 * Keeps `context` unchanged lines around each change and replaces the rest with a
 * `…` marker, so a long file shows only the edited regions.
 */
export function trimContext(ops: readonly DiffOp[], context: number): DiffOp[] {
  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((op, index) => {
    if (op.kind === 'equal') return
    for (
      let i = Math.max(0, index - context);
      i <= Math.min(ops.length - 1, index + context);
      i++
    ) {
      keep[i] = true
    }
  })
  const out: DiffOp[] = []
  let skipped = false
  ops.forEach((op, index) => {
    if (keep[index]) {
      out.push(op)
      skipped = false
    } else if (!skipped) {
      out.push({ kind: 'equal', line: '…' })
      skipped = true
    }
  })
  return out
}
