/**
 * CI failure classification from log text. Classification is a triage aid: it recommends the next
 * action, and a human or the caller decides whether to act on it.
 */
export type CiCategory =
  | 'compilation'
  | 'unit-test'
  | 'integration-test'
  | 'flaky-test'
  | 'infrastructure'
  | 'credentials'
  | 'lint-format'
  | 'security-scan'
  | 'performance'
  | 'unknown'

export type CiTriage = {
  category: CiCategory
  evidence: string
  action: string
  stopLoop: boolean
}

const RULES: ReadonlyArray<{ category: CiCategory; pattern: RegExp; action: string; stopLoop: boolean }> = [
  {
    category: 'credentials',
    pattern: /(401 Unauthorized|403 Forbidden|Bad credentials|authentication failed|expired token|invalid_grant|No linked GitHub account)/i,
    action: 'Stop fixing code. Refresh the credential or access grant, then rerun the job.',
    stopLoop: true,
  },
  {
    category: 'infrastructure',
    pattern: /(ECONNRESET|ETIMEDOUT|ENOTFOUND|503 Service|502 Bad Gateway|rate limit|quota exceeded|No space left on device|runner .* lost|The operation was canceled)/i,
    action: 'Stop fixing code. Rerun the job or check the runner and quota.',
    stopLoop: true,
  },
  {
    category: 'flaky-test',
    pattern: /(flaky|retrying test|passed on retry|intermittent)/i,
    action: 'Quarantine the test with an owner and an issue, then fix its nondeterminism.',
    stopLoop: false,
  },
  {
    category: 'compilation',
    pattern: /(error TS\d+|SyntaxError|cannot find symbol|COMPILATION ERROR|error\[E\d+\]|build failed)/i,
    action: 'Reproduce locally with the build command and fix the first compiler error.',
    stopLoop: false,
  },
  {
    category: 'lint-format',
    pattern: /(eslint|prettier --check|ruff check|golangci-lint|clippy::|formatting differences)/i,
    action: 'Run the formatter and linter locally; fix the reported files.',
    stopLoop: false,
  },
  {
    category: 'security-scan',
    pattern: /(vulnerab|CVE-\d{4}-\d+|npm audit|pip-audit|osv-scanner|secret detected)/i,
    action: 'Triage the finding; update the dependency or document an accepted risk.',
    stopLoop: false,
  },
  {
    category: 'performance',
    pattern: /(benchmark regression|budget exceeded|performance budget|p95 .* exceeded)/i,
    action: 'Compare against the baseline; profile the changed path before changing code.',
    stopLoop: false,
  },
  {
    category: 'integration-test',
    pattern: /(integration test|e2e|testcontainers|connection refused.*(5432|6379|9092))/i,
    action: 'Check the service dependencies the test needs, then reproduce with the same services up.',
    stopLoop: false,
  },
  {
    category: 'unit-test',
    pattern: /(AssertionError|expect\(|FAIL\s|\d+ failed|Tests?:\s+\d+ failed)/i,
    action: 'Reproduce the failing test locally and fix its behaviour, not the assertion.',
    stopLoop: false,
  },
]

/** The first matching rule wins. Rules are ordered so infrastructure and credentials stop a loop. */
export function triageLog(text: string): CiTriage {
  for (const rule of RULES) {
    const match = rule.pattern.exec(text)
    if (match !== null) {
      return { category: rule.category, evidence: match[0].slice(0, 120), action: rule.action, stopLoop: rule.stopLoop }
    }
  }
  return {
    category: 'unknown',
    evidence: '',
    action: 'Read the first error in the log and reproduce it locally before changing code.',
    stopLoop: false,
  }
}
