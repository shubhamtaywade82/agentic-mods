/**
 * Classifies SQL migration text. `destructive` changes can lose data or block writes and need
 * review before they run. `review` changes need a deliberate decision on large tables.
 * A line containing `reviewed:` acknowledges a destructive finding in that migration.
 */
export type MigrationSeverity = 'destructive' | 'review'

export type MigrationFinding = {
  severity: MigrationSeverity
  rule: string
  line: number
  text: string
}

type Rule = { id: string; severity: MigrationSeverity; pattern: RegExp }

const RULES: readonly Rule[] = [
  {
    id: 'drop-object',
    severity: 'destructive',
    pattern: /\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b/i,
  },
  { id: 'truncate', severity: 'destructive', pattern: /\bTRUNCATE\b/i },
  { id: 'rename', severity: 'destructive', pattern: /\bRENAME\s+(COLUMN|TO)\b/i },
  {
    id: 'update-without-where',
    severity: 'destructive',
    pattern: /\bUPDATE\s+\w+\s+SET\b(?![^;]*\bWHERE\b)/i,
  },
  {
    id: 'not-null-without-default',
    severity: 'review',
    pattern: /\bADD\s+COLUMN\s+(?![^;]*\bDEFAULT\b)[^;]*\bNOT\s+NULL\b/i,
  },
  {
    id: 'set-not-null',
    severity: 'review',
    pattern: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i,
  },
  {
    id: 'index-not-concurrent',
    severity: 'review',
    pattern: /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)/i,
  },
]

export function classifyMigrationSql(text: string): MigrationFinding[] {
  const findings: MigrationFinding[] = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (/reviewed:/i.test(line)) return
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          severity: rule.severity,
          rule: rule.id,
          line: index + 1,
          text: line.trim().slice(0, 200),
        })
      }
    }
  })
  return findings
}

/** Migration paths across the supported migration tools. */
export const MIGRATION_PATH =
  /(^|\/)(migrations?|db\/migrate|flyway|liquibase|alembic\/versions|prisma\/migrations)(\/|$)|\.sql$/i
