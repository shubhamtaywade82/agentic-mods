/**
 * Regression risk. Every point is listed with its reason, so the scope is explained rather than
 * judged. Weights and thresholds come from configuration in the caller.
 */
export type RiskFactor =
  | 'publicApi'
  | 'schema'
  | 'sharedLibrary'
  | 'auth'
  | 'lockfile'
  | 'buildConfig'
  | 'manyFiles'
  | 'testsOnly'
  | 'docsOnly'

export const DEFAULT_RISK_WEIGHTS: Readonly<Record<RiskFactor, number>> = {
  publicApi: 30,
  schema: 30,
  sharedLibrary: 20,
  auth: 25,
  lockfile: 15,
  buildConfig: 20,
  manyFiles: 15,
  testsOnly: -10,
  docsOnly: -30,
}

export type RiskLevel = 'targeted' | 'component' | 'cross-component' | 'full'

export type RiskResult = {
  score: number
  level: RiskLevel
  reasons: string[]
  requires: string[]
}

const PATTERNS: Readonly<
  Record<'publicApi' | 'sharedLibrary' | 'auth' | 'lockfile' | 'buildConfig', RegExp>
> = {
  publicApi: /(openapi|swagger|\.graphql$|\.proto$|(^|\/)(api|routes?|controllers?)\/)/i,
  sharedLibrary: /(^|\/)(packages|shared|lib)\//,
  auth: /(auth|login|session|jwt|oauth|permission|rbac)/i,
  lockfile:
    /(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock)$/,
  buildConfig:
    /(tsconfig[^/]*\.json|webpack[^/]*|vite\.config[^/]*|turbo\.json|build\.gradle[^/]*|pom\.xml|Makefile|Dockerfile)$/,
}

const TEST_FILE = /(\.test\.|\.spec\.|(^|\/)tests?\/|_test\.(go|py)$|(^|\/)test_[^/]*\.py$)/
const DOC_FILE = /\.(md|txt|rst|adoc)$/i
const SCHEMA_FILE =
  /(^|\/)(migrations?|db\/migrate|prisma\/migrations|flyway|liquibase)(\/|$)|\.sql$/i

export function riskLevelOf(score: number): RiskLevel {
  if (score >= 60) return 'full'
  if (score >= 40) return 'cross-component'
  if (score >= 20) return 'component'
  return 'targeted'
}

export function assessRegression(
  changed: readonly string[],
  weights: Readonly<Record<RiskFactor, number>> = DEFAULT_RISK_WEIGHTS,
): RiskResult {
  const reasons: string[] = []
  let score = 0
  const add = (factor: RiskFactor, reason: string): void => {
    score += weights[factor]
    reasons.push(`${weights[factor] >= 0 ? '+' : ''}${weights[factor]}  ${reason}`)
  }

  const paths = changed.map((path) => path.replace(/\\/g, '/'))
  if (paths.some((path) => PATTERNS.publicApi.test(path)))
    add('publicApi', 'public API or contract file changed')
  if (paths.some((path) => SCHEMA_FILE.test(path)))
    add('schema', 'database schema or migration changed')
  if (paths.some((path) => PATTERNS.sharedLibrary.test(path)))
    add('sharedLibrary', 'shared library code changed')
  if (paths.some((path) => PATTERNS.auth.test(path)))
    add('auth', 'authentication or authorization code changed')
  if (paths.some((path) => PATTERNS.lockfile.test(path)))
    add('lockfile', 'dependency lockfile changed')
  if (paths.some((path) => PATTERNS.buildConfig.test(path)))
    add('buildConfig', 'build configuration changed')
  if (paths.length > 20) add('manyFiles', `${paths.length} files changed`)
  if (paths.length > 0 && paths.every((path) => TEST_FILE.test(path)))
    add('testsOnly', 'only test files changed')
  if (paths.length > 0 && paths.every((path) => DOC_FILE.test(path)))
    add('docsOnly', 'only documentation changed')

  const clamped = Math.max(0, Math.min(100, score))
  const level = riskLevelOf(clamped)
  const requires = requiredChecks(level)
  return { score: clamped, level, reasons: [`score ${clamped} (${level})`, ...reasons], requires }
}

/** What each level runs. The caller maps these names to configured commands. */
export function requiredChecks(level: RiskLevel): string[] {
  switch (level) {
    case 'targeted':
      return ['unit-targeted']
    case 'component':
      return ['unit-targeted', 'component-suite']
    case 'cross-component':
      return ['unit-targeted', 'component-suite', 'consumer-compatibility', 'api-contract']
    case 'full':
      return ['full-suite']
  }
}
