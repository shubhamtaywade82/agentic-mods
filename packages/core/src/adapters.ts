import type { ImportLanguage } from './imports'

/**
 * Language adapters. Each one says how to recognise a project, how its tests are named and
 * which import syntax it uses. Commands are classified by `classify.ts` for every language.
 */
export type AdapterId = 'javascript' | 'java' | 'python' | 'go' | 'rust' | 'dotnet'

export type Adapter = {
  id: AdapterId
  label: string
  language: ImportLanguage
  /** File names (or suffixes starting with `*.`) that mark a project of this kind. */
  manifests: readonly string[]
  isTestFile: (path: string) => boolean
}

const JS_TEST = /(^|\/)(__tests__\/|test\/|tests\/)|\.(test|spec)\.[cm]?[jt]sx?$/
const JAVA_TEST = /(^|\/)src\/test\//
const PY_TEST = /(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.py$/
const GO_TEST = /_test\.go$/
const RUST_TEST = /(^|\/)tests\/[^/]+\.rs$/
const DOTNET_TEST = /(^|\/)[^/]*\.(Tests?|UnitTests?|IntegrationTests?)(\/|$)|Tests?\.cs$/

export const ADAPTERS: Readonly<Record<AdapterId, Adapter>> = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript / TypeScript',
    language: 'typescript',
    manifests: ['package.json'],
    isTestFile: path => JS_TEST.test(path),
  },
  java: {
    id: 'java',
    label: 'Java / Spring',
    language: 'java',
    manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    isTestFile: path => JAVA_TEST.test(path),
  },
  python: {
    id: 'python',
    label: 'Python',
    language: 'python',
    manifests: ['pyproject.toml', 'requirements.txt', 'setup.py'],
    isTestFile: path => PY_TEST.test(path),
  },
  go: {
    id: 'go',
    label: 'Go',
    language: 'go',
    manifests: ['go.mod'],
    isTestFile: path => GO_TEST.test(path),
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    language: 'rust',
    manifests: ['Cargo.toml'],
    isTestFile: path => RUST_TEST.test(path),
  },
  dotnet: {
    id: 'dotnet',
    label: '.NET',
    language: 'csharp',
    manifests: ['*.csproj', '*.sln'],
    isTestFile: path => DOTNET_TEST.test(path),
  },
}

function matchesManifest(fileName: string, manifest: string): boolean {
  if (manifest.startsWith('*.')) return fileName.endsWith(manifest.slice(1))
  return fileName === manifest
}

/** The adapters whose manifests appear among the given file paths. */
export function detectAdapters(paths: readonly string[]): AdapterId[] {
  const names = paths.map(path => path.replace(/^.*\//, ''))
  const found: AdapterId[] = []
  for (const adapter of Object.values(ADAPTERS)) {
    if (names.some(name => adapter.manifests.some(manifest => matchesManifest(name, manifest)))) {
      found.push(adapter.id)
    }
  }
  return found
}
