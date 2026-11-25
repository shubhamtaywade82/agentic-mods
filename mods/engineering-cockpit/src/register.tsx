import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { assessReadiness, loadConfig, type ReadinessInput, type Verdict } from '@agentic-mods/core'
import type { EvidenceStatus } from '../../evidence-gate/types'
import type { ContractStatus } from '../../change-contract/types'
import type { ImpactStatus } from '../../test-impact/types'
import type { ReviewGate } from '../../review-tracker/types'
import type { ArchitectureStatus } from '../../architecture-guard/types'
import type { MigrationStatus } from '../../migration-sentinel/types'
import type { RadarStatus } from '../../dependency-radar/types'
import type { BudgetStatus } from '../../performance-budget/types'
import type { CockpitRow } from '../types'

const PANE = 'engineering-cockpit'

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const CONTRACT_IDLE: ContractStatus = { active: false, objective: '', violations: 0, mode: 'warn' }
const IMPACT_IDLE: ImpactStatus = {
  selection: [],
  untested: [],
  full: false,
  reason: 'not computed yet',
}
const REVIEW_IDLE: ReviewGate = {
  verdict: 'UNKNOWN',
  openHigh: 0,
  open: 0,
  reason: 'no review findings recorded',
}
const ARCH_IDLE: ArchitectureStatus = {
  verdict: 'UNKNOWN',
  reason: 'not scanned yet',
  fresh: 0,
  baseline: 0,
}
const MIGRATION_IDLE: MigrationStatus = { verdict: 'UNKNOWN', findings: [] }
const RADAR_IDLE: RadarStatus = { verdict: 'UNKNOWN', changes: [], scan: 'no scan recorded' }
const BUDGET_IDLE: BudgetStatus = { verdict: 'UNKNOWN', rows: ['no measurement checked yet'] }

const evidence = atom({ plugin: 'evidence-gate', key: 'status' } as const, EVIDENCE_IDLE, {
  shape: 'status-1',
})
const contract = atom({ plugin: 'change-contract', key: 'status' } as const, CONTRACT_IDLE, {
  shape: 'status-1',
})
const impact = atom({ plugin: 'test-impact', key: 'impact' } as const, IMPACT_IDLE, {
  shape: 'impact-1',
})
const review = atom({ plugin: 'review-tracker', key: 'gate' } as const, REVIEW_IDLE, {
  shape: 'gate-1',
})
const architecture = atom({ plugin: 'architecture-guard', key: 'status' } as const, ARCH_IDLE, {
  shape: 'status-1',
})
const migration = atom({ plugin: 'migration-sentinel', key: 'status' } as const, MIGRATION_IDLE, {
  shape: 'status-1',
})
const radar = atom({ plugin: 'dependency-radar', key: 'status' } as const, RADAR_IDLE, {
  shape: 'status-1',
})
const budget = atom({ plugin: 'performance-budget', key: 'status' } as const, BUDGET_IDLE, {
  shape: 'status-1',
})

async function readinessInput($: EngineInterface): Promise<ReadinessInput> {
  const [ev, ct, rv, ar] = await Promise.all([
    read($, evidence),
    read($, contract),
    read($, review),
    read($, architecture),
  ])
  return { contract: ct, evidence: ev, review: rv, architecture: ar }
}

async function rowsOf($: EngineInterface): Promise<CockpitRow[]> {
  const [ct, im, ev, rv, ar, mg, rd, bd] = await Promise.all([
    read($, contract),
    read($, impact),
    read($, evidence),
    read($, review),
    read($, architecture),
    read($, migration),
    read($, radar),
    read($, budget),
  ])
  const impactVerdict: Verdict = im.full || im.untested.length > 0 ? 'UNKNOWN' : 'PASS'
  const readiness = assessReadiness(await readinessInput($))
  return [
    {
      label: 'CONTRACT',
      verdict: !ct.active ? 'UNKNOWN' : ct.violations === 0 ? 'PASS' : 'FAIL',
      detail: ct.active
        ? `${ct.mode} · ${ct.violations} write(s) outside scope`
        : 'no contract recorded',
    },
    {
      label: 'IMPACT',
      verdict: impactVerdict,
      detail: im.full
        ? `full suite: ${im.reason}`
        : `${im.selection.length} test(s) selected · ${im.untested.length} untested change(s)`,
    },
    {
      label: 'EVIDENCE',
      verdict: ev.overall,
      detail:
        ev.checks.map((item) => `${item.check} ${item.verdict}`).join(' · ') || 'no checks run',
    },
    { label: 'REVIEW', verdict: rv.verdict, detail: rv.reason },
    { label: 'ARCHITECTURE', verdict: ar.verdict, detail: ar.reason },
    {
      label: 'MIGRATION',
      verdict: mg.verdict,
      detail: mg.findings[0] ?? 'no migration changes reviewed',
    },
    { label: 'DEPENDENCIES', verdict: rd.verdict, detail: rd.changes[0] ?? rd.scan },
    { label: 'PERFORMANCE', verdict: bd.verdict, detail: bd.rows[0] ?? 'no measurement checked' },
    {
      label: 'RELEASE',
      verdict:
        readiness.verdict === 'READY'
          ? 'PASS'
          : readiness.verdict === 'NOT READY'
            ? 'FAIL'
            : 'UNKNOWN',
      detail: `readiness ${readiness.verdict}`,
    },
  ]
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agentic',
      description: 'Cockpit: /agentic status | doctor | privacy',
    })
    return next(e)
  })

  on('command.run', { command: 'agentic' }, async ($, e) => {
    const subcommand = e.args.trim() || 'status'
    if (subcommand === 'status') {
      await $.ui.open({ id: PANE, title: 'Engineering cockpit' })
      const rows = await rowsOf($)
      return {
        text: rows
          .map((row) => `${row.label.padEnd(13)} ${row.verdict.padEnd(9)} ${row.detail}`)
          .join('\n'),
      }
    }
    if (subcommand === 'doctor') {
      const loaded = await loadConfig((path) => $.fs.read(path))
      const rows = await rowsOf($)
      const lines = [
        loaded.errors.length === 0 ? 'config: valid' : 'config problems:',
        ...loaded.errors.map((message) => `  ${message}`),
        `cockpit rows with UNKNOWN: ${
          rows
            .filter((row) => row.verdict === 'UNKNOWN')
            .map((row) => row.label)
            .join(', ') || 'none'
        }`,
      ]
      return { text: lines.join('\n') }
    }
    if (subcommand === 'privacy') {
      return {
        text: [
          'Local only. No network calls and no remote telemetry are made by these mods.',
          'Files written under .agentic-mods/: contract.json, findings.json, ledger.json,',
          'architecture-baseline.json, audit/*.jsonl, incidents/*, scans/* (read only).',
          "Session values are kept in each mod's own store, shared across sessions on this machine.",
          'Secret-looking values are redacted before they are written to an audit or timeline file.',
        ].join('\n'),
      }
    }
    return { text: 'Usage: /agentic status | doctor | privacy' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = await rowsOf($)
    const readiness = assessReadiness(await readinessInput($))
    return (
      <Box flexDirection="column">
        <Text>Release: {readiness.verdict}</Text>
        {rows.map((row) => (
          <Text key={row.label}>
            {row.label.padEnd(13)} {row.verdict.padEnd(9)} {row.detail}
          </Text>
        ))}
      </Box>
    )
  })
}
