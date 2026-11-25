import { isProtectedPath } from './paths'

/** The checks a repository can be verified with. Evidence is recorded per check. */
export const CHECKS = ['build', 'test', 'lint', 'typecheck', 'security'] as const
export type CheckName = (typeof CHECKS)[number]

export function isCheckName(value: unknown): value is CheckName {
  return typeof value === 'string' && (CHECKS as readonly string[]).includes(value)
}

export type GitAction = 'commit' | 'push' | 'pr-create'

export type DangerLevel = 'confirm' | 'always-block'

export type DangerHit = {
  rule: string
  level: DangerLevel
  reason: string
}

export type CommandAnalysis = {
  checks: CheckName[]
  gitActions: GitAction[]
  dangers: DangerHit[]
}

/** Splits a shell line into simple commands. Pipes split too, so rules that need the whole line use it. */
export function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/** A shell-like tokenizer for one simple command. It is not a shell: nothing is expanded. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasToken = false
  for (const ch of segment) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += ch
    hasToken = true
  }
  if (hasToken) tokens.push(current)
  return tokens
}

const WRAPPERS = new Set(['env', 'time', 'sudo', 'nohup', 'command', 'exec', 'nice'])

/** The argv of a simple command after wrappers and `VAR=value` prefixes. */
export function argvOf(segment: string): string[] {
  const tokens = tokenize(segment)
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] ?? ''
    if (WRAPPERS.has(token) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || token.startsWith('-')) {
      index++
      continue
    }
    break
  }
  return tokens.slice(index)
}

const SCRIPT_CHECKS: Readonly<Record<string, CheckName>> = {
  build: 'build',
  test: 'test',
  lint: 'lint',
  typecheck: 'typecheck',
  'type-check': 'typecheck',
  'check:types': 'typecheck',
}

function checkOf(argv: readonly string[]): CheckName | null {
  const head = argv[0] ?? ''
  const base = head.replace(/^.*\//, '')
  const second = argv[1] ?? ''
  const third = argv[2] ?? ''
  const positional = argv.slice(1).filter((token) => !token.startsWith('-'))

  switch (base) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      if (positional[0] === 'audit') return 'security'
      if (positional[0] === 'run' || positional[0] === 'run-script') {
        return SCRIPT_CHECKS[positional[1] ?? ''] ?? null
      }
      return SCRIPT_CHECKS[positional[0] ?? ''] ?? null
    }
    case 'npx':
    case 'pnpx':
    case 'bunx': {
      const tool = (positional[0] ?? '').replace(/^.*\//, '')
      if (tool === 'jest' || tool === 'vitest') return 'test'
      if (tool === 'eslint') return 'lint'
      if (tool === 'tsc') return argv.includes('--noEmit') ? 'typecheck' : 'build'
      return null
    }
    case 'jest':
    case 'vitest':
      return 'test'
    case 'tsc':
      return argv.includes('--noEmit') ? 'typecheck' : 'build'
    case 'eslint':
      return 'lint'
    case 'biome':
      return second === 'check' || second === 'lint' ? 'lint' : null
    case 'prettier':
      return argv.includes('--check') ? 'lint' : null
    case 'pytest':
    case 'py.test':
      return 'test'
    case 'python':
    case 'python3':
      return second === '-m' && third === 'pytest' ? 'test' : null
    case 'mypy':
    case 'pyright':
      return 'typecheck'
    case 'ruff':
      return second === 'check' || (second === 'format' && argv.includes('--check')) ? 'lint' : null
    case 'pip-audit':
    case 'safety':
    case 'osv-scanner':
    case 'govulncheck':
      return 'security'
    case 'go':
      if (second === 'test') return 'test'
      if (second === 'build') return 'build'
      if (second === 'vet') return 'lint'
      return null
    case 'golangci-lint':
      return 'lint'
    case 'cargo':
      if (second === 'test') return 'test'
      if (second === 'build') return 'build'
      if (second === 'clippy') return 'lint'
      if (second === 'check') return 'typecheck'
      if (second === 'audit') return 'security'
      return null
    case 'mvn':
    case 'mvnw':
      if (second === 'test') return 'test'
      if (second === 'package' || second === 'install' || second === 'verify') return 'build'
      return null
    case 'gradle':
    case 'gradlew':
      if (second === 'test') return 'test'
      if (second === 'build') return 'build'
      return null
    case 'dotnet':
      if (second === 'test') return 'test'
      if (second === 'build') return 'build'
      if (second === 'format' && argv.includes('--verify-no-changes')) return 'lint'
      return null
    case 'make':
      return SCRIPT_CHECKS[second] ?? null
    case 'turbo':
      return second === 'run' ? (SCRIPT_CHECKS[third] ?? null) : null
    default:
      return null
  }
}

/** The git or gh action a simple command performs, if it is one of the gated actions. */
export function gitActionOf(argv: readonly string[]): GitAction | null {
  if (argv[0] === 'gh') {
    return argv[1] === 'pr' && argv[2] === 'create' ? 'pr-create' : null
  }
  if (argv[0] !== 'git') return null
  let index = 1
  while (index < argv.length) {
    const token = argv[index] ?? ''
    if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree') {
      index += 2
      continue
    }
    if (token.startsWith('-')) {
      index++
      continue
    }
    break
  }
  const subcommand = argv[index]
  if (subcommand === 'commit') return 'commit'
  if (subcommand === 'push') return 'push'
  return null
}

function gitSubcommand(argv: readonly string[]): string | null {
  if (argv[0] !== 'git') return null
  for (const token of argv.slice(1)) {
    if (!token.startsWith('-')) return token
  }
  return null
}

/** Short flags of a command, as one string: `-rf` gives `rf`, `--force` gives nothing. */
function shortFlags(argv: readonly string[]): string {
  return argv
    .filter((token) => token.startsWith('-') && !token.startsWith('--'))
    .map((token) => token.slice(1))
    .join('')
}

type DangerRule = {
  id: string
  level: DangerLevel
  reason: string
  matches: (argv: readonly string[], text: string) => boolean
}

/** Ordered so that always-block rules are reported before confirm rules. */
const DANGER_RULES: readonly DangerRule[] = [
  {
    id: 'pipe-to-shell',
    level: 'always-block',
    reason: 'downloads and executes code without review',
    matches: (_argv, text) => /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(text),
  },
  {
    id: 'disk-overwrite',
    level: 'always-block',
    reason: 'formats or overwrites a block device',
    matches: (_argv, text) =>
      /(^|\s)mkfs(\.\w+)?\b/.test(text) || /\bdd\s+if=/.test(text) || /of=\/dev\//.test(text),
  },
  {
    id: 'database-drop',
    level: 'always-block',
    reason: 'drops a whole database or schema',
    matches: (_argv, text) => /\bdrop\s+(database|schema)\b/i.test(text),
  },
  {
    id: 'cloud-project-delete',
    level: 'always-block',
    reason: 'deletes a cloud project and everything in it',
    matches: (argv) => argv[0] === 'gcloud' && argv[1] === 'projects' && argv[2] === 'delete',
  },
  {
    id: 'recursive-force-delete',
    level: 'confirm',
    reason: 'deletes a tree of files without prompts',
    matches: (argv) => {
      if (argv[0] !== 'rm') return false
      const flags = shortFlags(argv)
      const recursive = /[rR]/.test(flags) || argv.includes('--recursive')
      const force = /f/.test(flags) || argv.includes('--force')
      return recursive && force
    },
  },
  {
    id: 'git-force-push',
    level: 'confirm',
    reason: 'rewrites remote history',
    matches: (argv) =>
      gitSubcommand(argv) === 'push' &&
      argv.some(
        (token) => token === '--force' || token === '-f' || token.startsWith('--force-with-lease'),
      ),
  },
  {
    id: 'git-hard-reset',
    level: 'confirm',
    reason: 'discards uncommitted work',
    matches: (argv) => gitSubcommand(argv) === 'reset' && argv.includes('--hard'),
  },
  {
    id: 'git-clean-force',
    level: 'confirm',
    reason: 'deletes untracked files',
    matches: (argv) => gitSubcommand(argv) === 'clean' && shortFlags(argv).includes('f'),
  },
  {
    id: 'sql-table-destruction',
    level: 'confirm',
    reason: 'drops or truncates table data',
    matches: (_argv, text) => /\b(drop\s+table|truncate\s+table)\b/i.test(text),
  },
  {
    id: 'infrastructure-delete',
    level: 'confirm',
    reason: 'deletes cluster or infrastructure resources',
    matches: (argv) =>
      (argv[0] === 'kubectl' && argv[1] === 'delete') ||
      (argv[0] === 'helm' && argv[1] === 'uninstall') ||
      (argv[0] === 'terraform' && argv[1] === 'destroy') ||
      (argv[0] === 'aws' && argv[1] === 'cloudformation' && argv[2] === 'delete-stack') ||
      (argv[0] === 'az' && argv[1] === 'group' && argv[2] === 'delete'),
  },
  {
    id: 'docker-prune',
    level: 'confirm',
    reason: 'removes docker images, containers or volumes',
    matches: (argv) =>
      argv[0] === 'docker' && (argv[1] === 'system' || argv[1] === 'volume') && argv[2] === 'prune',
  },
  {
    id: 'world-writable',
    level: 'confirm',
    reason: 'makes files world-writable',
    matches: (argv) =>
      argv[0] === 'chmod' && shortFlags(argv).includes('R') && argv.includes('777'),
  },
]

/** Classifies every simple command in a shell line. */
export function analyzeCommand(command: string): CommandAnalysis {
  const checks: CheckName[] = []
  const gitActions: GitAction[] = []
  const dangers: DangerHit[] = []
  const seenRules = new Set<string>()

  const addDanger = (rule: DangerRule): void => {
    if (seenRules.has(rule.id)) return
    seenRules.add(rule.id)
    dangers.push({ rule: rule.id, level: rule.level, reason: rule.reason })
  }

  for (const rule of DANGER_RULES) {
    if (rule.matches([], command)) addDanger(rule)
  }

  for (const segment of splitSegments(command)) {
    const argv = argvOf(segment)
    const check = checkOf(argv)
    if (check !== null && !checks.includes(check)) checks.push(check)
    const action = gitActionOf(argv)
    if (action !== null && !gitActions.includes(action)) gitActions.push(action)
    for (const rule of DANGER_RULES) {
      if (rule.matches(argv, segment)) addDanger(rule)
    }
  }

  return { checks, gitActions, dangers }
}

const READ_VERBS = new Set([
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'sed',
  'awk',
  'source',
  'xxd',
  'od',
  'strings',
  'base64',
  'bat',
  'nl',
  'tac',
  'cut',
  'sort',
  'diff',
  'cp',
  'mv',
  'tar',
  'zip',
  'scp',
  'rsync',
  'curl',
  'wget',
])

/**
 * Protected files a shell command would read or copy. Only the file-reading verbs above are
 * matched, and only file arguments that equal a protected path. Reads through an interpreter
 * (`python -c open(...)`) are not detected; that gap is documented in SECURITY.md.
 */
export function secretFileReads(
  command: string,
  protectedGlobs: readonly string[],
  exceptions: readonly string[],
): string[] {
  const hits: string[] = []
  for (const segment of splitSegments(command)) {
    const argv = argvOf(segment)
    const verb = (argv[0] ?? '').replace(/^.*\//, '')
    if (!READ_VERBS.has(verb)) continue
    for (const token of argv.slice(1)) {
      if (token.startsWith('-')) continue
      const candidate = token.replace(/^[<>]+/, '')
      if (candidate !== '' && isProtectedPath(candidate, protectedGlobs, exceptions))
        hits.push(candidate)
    }
  }
  return [...new Set(hits)]
}

/** Dangers ordered by severity: always-block first. */
export function sortDangers(dangers: readonly DangerHit[]): DangerHit[] {
  return [...dangers].sort((a, b) =>
    a.level === b.level ? 0 : a.level === 'always-block' ? -1 : 1,
  )
}

/** An argv as stored in configuration: a non-empty array of non-empty strings. */
export function isArgv(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  )
}
