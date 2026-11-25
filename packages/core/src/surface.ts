/**
 * The exported surface of a TypeScript or JavaScript file, read as text. This is an approximation
 * for behaviour locking: it sees top-level exports and their first declaration line. It does not
 * resolve types, re-exports through other files, or generated code.
 */
export type ExportEntry = {
  name: string
  signature: string
}

const EXPORT_DECL =
  /^export\s+(?:declare\s+)?(async\s+)?(function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
const EXPORT_DEFAULT = /^export\s+default\b/
const EXPORT_LIST = /^export\s*\{([^}]*)\}/

export function extractSurface(source: string): ExportEntry[] {
  const entries: ExportEntry[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    const declaration = EXPORT_DECL.exec(line)
    if (declaration !== null) {
      entries.push({ name: declaration[3] ?? '', signature: line.replace(/\s*\{?\s*$/, '').slice(0, 300) })
      continue
    }
    if (EXPORT_DEFAULT.test(line)) {
      entries.push({ name: 'default', signature: line.slice(0, 300) })
      continue
    }
    const list = EXPORT_LIST.exec(line)
    if (list !== null) {
      for (const part of (list[1] ?? '').split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop() ?? ''
        if (name !== '') entries.push({ name, signature: `re-export ${name}` })
      }
    }
  }
  return entries
}

export type SurfaceDiff = {
  removed: string[]
  changed: string[]
  added: string[]
}

/** Breaking changes are removed or changed entries. Added entries are additive. */
export function diffSurface(before: readonly ExportEntry[], after: readonly ExportEntry[]): SurfaceDiff {
  const beforeMap = new Map(before.map(entry => [entry.name, entry.signature] as const))
  const afterMap = new Map(after.map(entry => [entry.name, entry.signature] as const))
  const removed = [...beforeMap.keys()].filter(name => !afterMap.has(name)).sort()
  const added = [...afterMap.keys()].filter(name => !beforeMap.has(name)).sort()
  const changed = [...beforeMap.keys()]
    .filter(name => afterMap.has(name) && beforeMap.get(name) !== afterMap.get(name))
    .sort()
  return { removed, changed, added }
}
