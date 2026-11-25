// Destructive-command detection for the guardian mod. Pure TypeScript.
//
// Scope: this recognizes defined high-blast-radius command PATTERNS; it is a
// tripwire, not a shell parser or a sandbox. Anything unrecognized passes.

export type BlastKind =
  | 'rm-rf'
  | 'force-push'
  | 'history-rewrite'
  | 'prod-db-write'
  | 'db-migration'
  | 'drop-database'
  | 'chmod-777-root'
  | 'dd-to-device'
  | 'git-clean-force'

export interface BlastMatch {
  kind: BlastKind
  /** Human explanation of the impact, shown in the denial. */
  why: string
}

interface Rule {
  kind: BlastKind
  why: string
  test: (cmd: string) => boolean
}

const isProdDb = (cmd: string): boolean => /\b(?:prod(?:uction)?|live|primary)\b/i.test(cmd)

/** Rules evaluated in order; first match wins. */
const RULES: readonly Rule[] = [
  {
    kind: 'rm-rf',
    why: 'recursively force-deletes files; recovery is impossible in most setups',
    test: (c) =>
      /(^|[\s;&|])(rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b|rm\s+-rf\b)/.test(c) ||
      /rm\s+--recursive\s+--force/.test(c),
  },
  {
    kind: 'force-push',
    why: 'overwrites remote history; other contributors lose commits',
    test: (c) => /git\s+push\b[^\n]*\s(-f\b|--force\b)/.test(c) && !/force-with-lease/.test(c),
  },
  {
    kind: 'history-rewrite',
    why: 'rewrites history or drops commits on the current branch',
    test: (c) =>
      /git\s+(filter-branch|rebase\b[^\n]*--root|reflog\s+expire\b[^\n]*--expire=now)/.test(c),
  },
  {
    kind: 'drop-database',
    why: 'drops an entire database',
    test: (c) => /\bDROP\s+DATABASE\b/i.test(c) || /--drop-database/.test(c),
  },
  {
    kind: 'prod-db-write',
    why: 'writes to what looks like a production database',
    test: (c) =>
      isProdDb(c) && /\b(?:psql|mysql|psqlpg|pg_restore|pg_dump|redis-cli|mongo|mongosh)\b/.test(c),
  },
  {
    kind: 'db-migration',
    why: 'runs a database migration, which changes schema irreversibly',
    test: (c) =>
      /\b(?:bin\/rails\s+db:(?:migrate|reset|drop)|npx\s+prisma\s+migrate\s+(?:deploy|reset|dev)|python\s+manage\.py\s+migrate|alembic\s+upgrade)\b/.test(
        c,
      ),
  },
  {
    kind: 'chmod-777-root',
    why: 'makes a system-wide path world-writable',
    test: (c) => /chmod\s+-R\s+777\s+\//.test(c),
  },
  {
    kind: 'dd-to-device',
    why: 'raw-writes to a disk device',
    test: (c) => /\bdd\b[^\n]*\bof=\/dev\/(?:disk|sd|nvme|hd)/.test(c),
  },
  {
    kind: 'git-clean-force',
    why: 'force-deletes all untracked files and directories',
    test: (c) => /git\s+clean\b[^\n]*-(?:[a-zA-Z]*f)/.test(c),
  },
] as const

/** Test a shell command string against the destructive-command rules. */
export function checkCommand(cmd: string): BlastMatch | null {
  if (!cmd) return null
  for (const r of RULES) {
    if (r.test(cmd)) return { kind: r.kind, why: r.why }
  }
  return null
}

/** Build the denial text for a matched command (never echoes the command). */
export function denyMessage(m: BlastMatch): string {
  return (
    `guardian blocked this command (${m.kind}): ${m.why}. ` +
    'If you really intend this, run it yourself in a terminal, or ask the user to disable guardian for this call.'
  )
}
