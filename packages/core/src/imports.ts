/** Import extraction by language. Regular expressions over source text, not a full parser. */
export type ImportLanguage = 'typescript' | 'java' | 'python' | 'go' | 'rust' | 'csharp'

const TS_IMPORT =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
const PY_FROM = /^\s*from\s+([.\w]+)\s+import\b/gm
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm
const JAVA_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?\s*;/gm
const GO_SINGLE = /^\s*import\s+"([^"]+)"/gm
const GO_BLOCK = /import\s*\(([\s\S]*?)\)/g
const GO_QUOTED = /"([^"]+)"/g
const RUST_USE = /^\s*(?:pub\s+)?use\s+([\w:]+)/gm
const CSHARP_USING = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm

function collect(pattern: RegExp, source: string, group = 1): string[] {
  const found: string[] = []
  for (const match of source.matchAll(pattern)) {
    const value = match[group]
    if (value !== undefined && value.length > 0) found.push(value)
  }
  return found
}

/** Module specifiers the source imports, in order of appearance, without duplicates. */
export function extractImports(language: ImportLanguage, source: string): string[] {
  let found: string[]
  switch (language) {
    case 'typescript':
      found = collect(TS_IMPORT, source)
      break
    case 'python':
      found = [
        ...collect(PY_FROM, source),
        ...collect(PY_IMPORT, source).flatMap((list) =>
          list.split(',').map((item) => item.trim().replace(/\s+as\s+\w+$/, '')),
        ),
      ]
      break
    case 'java':
      found = collect(JAVA_IMPORT, source)
      break
    case 'go': {
      found = collect(GO_SINGLE, source)
      for (const block of source.matchAll(GO_BLOCK)) {
        found.push(...collect(GO_QUOTED, block[1] ?? ''))
      }
      break
    }
    case 'rust':
      found = collect(RUST_USE, source)
      break
    case 'csharp':
      found = collect(CSHARP_USING, source)
      break
  }
  return [...new Set(found)]
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function normalizeSegments(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const TS_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Resolves a relative TypeScript/JavaScript specifier against the files that exist.
 * Bare package specifiers resolve to null: they are not repository edges.
 */
export function resolveTypeScriptImport(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null
  const base = normalizeSegments(`${dirname(fromFile)}/${specifier}`)
  const stripped = base.replace(/\.(m|c)?jsx?$/, '')
  const candidates: string[] = []
  for (const suffix of TS_SUFFIXES) candidates.push(`${base}${suffix}`)
  for (const suffix of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(`${stripped}${suffix}`)
  for (const suffix of ['/index.ts', '/index.tsx', '/index.js']) candidates.push(`${base}${suffix}`)
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate
  }
  return null
}

/**
 * Resolves a Java import to a repository file when the package path exists in the tree, e.g.
 * `com.acme.billing.Invoice` to `src/main/java/com/acme/billing/Invoice.java`.
 */
export function resolveJavaImport(specifier: string, known: ReadonlySet<string>): string | null {
  const relative = `${specifier.replace(/\./g, '/')}.java`
  for (const path of known) {
    if (path === relative || path.endsWith(`/${relative}`)) return path
  }
  return null
}

/** Internal edges of a file tree: file to the set of files it imports. */
export function buildTypeScriptGraph(
  sources: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const known = new Set(sources.keys())
  const graph = new Map<string, Set<string>>()
  for (const [file, source] of sources) {
    const edges = new Set<string>()
    for (const specifier of extractImports('typescript', source)) {
      const target = resolveTypeScriptImport(file, specifier, known)
      if (target !== null && target !== file) edges.add(target)
    }
    graph.set(file, edges)
  }
  return graph
}

/** Every file that transitively imports one of the changed files, including the changed files. */
export function dependentsOf(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  changed: Iterable<string>,
): Set<string> {
  const reverse = new Map<string, Set<string>>()
  for (const [file, targets] of graph) {
    for (const target of targets) {
      const importers = reverse.get(target) ?? new Set<string>()
      importers.add(file)
      reverse.set(target, importers)
    }
  }
  const seen = new Set<string>()
  const queue = [...changed]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || seen.has(next)) continue
    seen.add(next)
    for (const importer of reverse.get(next) ?? []) {
      if (!seen.has(importer)) queue.push(importer)
    }
  }
  return seen
}
