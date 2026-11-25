/** Dependency manifests of the supported ecosystems, read as text. No network, no resolution. */
export type Dependency = {
  name: string
  version: string
  isDev: boolean
  ecosystem: string
}

export const MANIFEST_FILES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
] as const

export function isManifestFile(path: string): boolean {
  const name = path.replace(/^.*\//, '')
  return (MANIFEST_FILES as readonly string[]).includes(name) || name.endsWith('.csproj')
}

/** Parses one manifest. Throws on malformed JSON so the caller can report it. */
export function parseManifest(path: string, text: string): Dependency[] {
  const name = path.replace(/^.*\//, '')
  if (name === 'package.json') return parsePackageJson(text)
  if (name === 'requirements.txt') return parseRequirements(text)
  if (name === 'pyproject.toml') return parsePyproject(text)
  if (name === 'go.mod') return parseGoMod(text)
  if (name === 'Cargo.toml') return parseCargo(text)
  if (name === 'pom.xml') return parseMaven(text)
  if (name === 'build.gradle' || name === 'build.gradle.kts') return parseGradle(text)
  if (name.endsWith('.csproj')) return parseCsproj(text)
  return []
}

function parsePackageJson(text: string): Dependency[] {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('package.json is not an object')
  const record = parsed as Record<string, unknown>
  const out: Dependency[] = []
  for (const [key, isDev] of [
    ['dependencies', false],
    ['devDependencies', true],
  ] as const) {
    const block = record[key]
    if (typeof block !== 'object' || block === null) continue
    for (const [name, version] of Object.entries(block)) {
      if (typeof version === 'string') out.push({ name, version, isDev, ecosystem: 'npm' })
    }
  }
  return out
}

function parseRequirements(text: string): Dependency[] {
  const out: Dependency[] = []
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? ''
    if (line === '' || line.startsWith('-')) continue
    const match = /^([A-Za-z0-9_.-]+)\s*(.*)$/.exec(line)
    if (match === null) continue
    out.push({ name: match[1] ?? '', version: (match[2] ?? '').trim(), isDev: false, ecosystem: 'pypi' })
  }
  return out
}

function parsePyproject(text: string): Dependency[] {
  const block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text)
  if (block === null) return []
  const out: Dependency[] = []
  for (const match of (block[1] ?? '').matchAll(/"([^"]+)"/g)) {
    const spec = match[1] ?? ''
    const parsed = /^([A-Za-z0-9_.-]+)\s*(.*)$/.exec(spec.trim())
    if (parsed === null) continue
    out.push({ name: parsed[1] ?? '', version: (parsed[2] ?? '').trim(), isDev: false, ecosystem: 'pypi' })
  }
  return out
}

function parseGoMod(text: string): Dependency[] {
  const out: Dependency[] = []
  const addLine = (line: string): void => {
    const match = /^\s*([^\s]+)\s+(v[^\s]+)/.exec(line.replace(/\/\/.*$/, ''))
    if (match !== null) {
      out.push({ name: match[1] ?? '', version: match[2] ?? '', isDev: false, ecosystem: 'go' })
    }
  }
  for (const block of text.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) {
    for (const line of (block[1] ?? '').split('\n')) addLine(line)
  }
  for (const single of text.matchAll(/^require\s+([^(\n]+)$/gm)) addLine(single[1] ?? '')
  return out
}

function parseCargo(text: string): Dependency[] {
  const out: Dependency[] = []
  let section: 'dependencies' | 'dev-dependencies' | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      if (line === '[dependencies]') section = 'dependencies'
      else if (line === '[dev-dependencies]') section = 'dev-dependencies'
      else section = null
      continue
    }
    if (section === null || line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (match === null) continue
    const value = (match[2] ?? '').trim()
    const version = /"([^"]+)"/.exec(value)?.[1] ?? value
    out.push({
      name: match[1] ?? '',
      version,
      isDev: section === 'dev-dependencies',
      ecosystem: 'cargo',
    })
  }
  return out
}

function parseMaven(text: string): Dependency[] {
  const out: Dependency[] = []
  for (const block of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = block[1] ?? ''
    const group = /<groupId>([^<]+)<\/groupId>/.exec(body)?.[1]
    const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(body)?.[1]
    const version = /<version>([^<]+)<\/version>/.exec(body)?.[1] ?? 'managed'
    const scope = /<scope>([^<]+)<\/scope>/.exec(body)?.[1]
    if (group === undefined || artifact === undefined) continue
    out.push({
      name: `${group}:${artifact}`,
      version,
      isDev: scope === 'test',
      ecosystem: 'maven',
    })
  }
  return out
}

function parseGradle(text: string): Dependency[] {
  const out: Dependency[] = []
  const pattern =
    /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly)\s*\(?\s*['"]([^:'"]+):([^:'"]+):([^'"]+)['"]/gm
  for (const match of text.matchAll(pattern)) {
    out.push({
      name: `${match[2] ?? ''}:${match[3] ?? ''}`,
      version: match[4] ?? '',
      isDev: (match[1] ?? '').startsWith('test'),
      ecosystem: 'gradle',
    })
  }
  return out
}

function parseCsproj(text: string): Dependency[] {
  const out: Dependency[] = []
  for (const match of text.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) {
    out.push({
      name: match[1] ?? '',
      version: match[2] ?? 'managed',
      isDev: false,
      ecosystem: 'nuget',
    })
  }
  return out
}

export type DependencyChange = {
  name: string
  from: string
  to: string
  isMajor: boolean
}

export type DependencyDiff = {
  added: Dependency[]
  removed: Dependency[]
  changed: DependencyChange[]
}

function majorOf(version: string): number | null {
  const match = /(\d+)/.exec(version)
  return match?.[1] === undefined ? null : Number(match[1])
}

/** Direct dependencies that appeared, disappeared or changed version between two manifests. */
export function diffDependencies(before: readonly Dependency[], after: readonly Dependency[]): DependencyDiff {
  const key = (dep: Dependency): string => `${dep.ecosystem}:${dep.isDev ? 'dev' : 'run'}:${dep.name}`
  const beforeMap = new Map(before.map(dep => [key(dep), dep] as const))
  const afterMap = new Map(after.map(dep => [key(dep), dep] as const))
  const added: Dependency[] = []
  const removed: Dependency[] = []
  const changed: DependencyChange[] = []
  for (const [id, dep] of afterMap) {
    const prior = beforeMap.get(id)
    if (prior === undefined) {
      added.push(dep)
      continue
    }
    if (prior.version !== dep.version) {
      const fromMajor = majorOf(prior.version)
      const toMajor = majorOf(dep.version)
      changed.push({
        name: dep.name,
        from: prior.version,
        to: dep.version,
        isMajor: fromMajor !== null && toMajor !== null && fromMajor !== toMajor,
      })
    }
  }
  for (const [id, dep] of beforeMap) {
    if (!afterMap.has(id)) removed.push(dep)
  }
  return { added, removed, changed }
}
