import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  classifyMigrationSql,
  type MigrationFinding,
  MIGRATION_PATH,
  normalizePath,
  truncate,
} from '@agentic-mods/core'
import type { MigrationStatus } from '../types'

const IDLE: MigrationStatus = { verdict: 'UNKNOWN', findings: [] }
const status = atom({ plugin: 'migration-sentinel', key: 'status' } as const, IDLE, {
  shape: 'status-1',
})

function verdictOf(findings: readonly MigrationFinding[]): MigrationStatus['verdict'] {
  if (findings.some((item) => item.severity === 'destructive')) return 'FAIL'
  if (findings.length > 0) return 'UNKNOWN'
  return 'PASS'
}

async function publish(
  $: EngineInterface,
  path: string,
  findings: readonly MigrationFinding[],
): Promise<void> {
  const lines = findings.map(
    (item) => `${path}:${item.line} ${item.severity} ${item.rule}: ${truncate(item.text, 160)}`,
  )
  await update($, status, () => ({ verdict: verdictOf(findings), findings: lines.slice(0, 50) }))
  for (const finding of findings) {
    if (finding.severity === 'destructive') {
      $.ui.toast(`migration-sentinel: ${finding.rule} in ${path}. Review before release.`)
    }
  }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'migration',
      description: 'Check a migration file: /migration check <path>',
    })
    return next(e)
  })

  on('command.run', { command: 'migration' }, async ($, e) => {
    const [subcommand = '', ...rest] = e.args.trim().split(/\s+/)
    if (subcommand !== 'check' || rest.length === 0) {
      return { text: 'Usage: /migration check <path to a migration file>' }
    }
    const path = normalizePath(rest.join(' '))
    const findings = classifyMigrationSql(await $.fs.read(path))
    await publish($, path, findings)
    if (findings.length === 0) return { text: `${path}: no destructive or locking patterns found.` }
    return {
      text: findings.map((item) => `line ${item.line}: ${item.severity} ${item.rule}`).join('\n'),
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (MIGRATION_PATH.test(e.file_path)) {
      await publish($, e.file_path, classifyMigrationSql(e.new_string))
    }
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (MIGRATION_PATH.test(e.file_path)) {
      await publish($, e.file_path, classifyMigrationSql(e.content))
    }
    return next(e)
  })
}
