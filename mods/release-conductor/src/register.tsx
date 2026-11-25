import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  assessReadiness,
  changedBetween,
  hasParentSegment,
  isAbsolutePath,
  stateRelativePath,
  type ReadinessInput,
  workingTreeChanges,
  type GitRunner,
  registerCommand,
} from '@agentic-mods/core'
import type { EvidenceStatus } from '../../evidence-gate/types'
import type { ContractStatus } from '../../change-contract/types'
import type { ReviewGate } from '../../review-tracker/types'
import type { ArchitectureStatus } from '../../architecture-guard/types'
import type { MigrationStatus } from '../../migration-sentinel/types'
import type { RadarStatus } from '../../dependency-radar/types'
import type { BudgetStatus } from '../../performance-budget/types'
import type { GateState } from '../types'

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'release not checked' }
const gate = atom({ plugin: 'release-conductor', key: 'gate' } as const, IDLE, { shape: 'gate-1' })

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const CONTRACT_IDLE: ContractStatus = { active: false, objective: '', violations: 0, mode: 'warn' }
const REVIEW_IDLE: ReviewGate = { verdict: 'UNKNOWN', openHigh: 0, open: 0, reason: 'none' }
const ARCH_IDLE: ArchitectureStatus = { verdict: 'UNKNOWN', reason: 'none', fresh: 0, baseline: 0 }
const MIGRATION_IDLE: MigrationStatus = { verdict: 'UNKNOWN', findings: [] }
const RADAR_IDLE: RadarStatus = { verdict: 'UNKNOWN', changes: [], scan: 'none' }
const BUDGET_IDLE: BudgetStatus = { verdict: 'UNKNOWN', rows: [] }

const evidence = atom({ plugin: 'evidence-gate', key: 'status' } as const, EVIDENCE_IDLE, {
  shape: 'status-1',
})
const contract = atom({ plugin: 'change-contract', key: 'status' } as const, CONTRACT_IDLE, {
  shape: 'status-1',
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
const dependencies = atom({ plugin: 'dependency-radar', key: 'status' } as const, RADAR_IDLE, {
  shape: 'status-1',
})
const performance = atom({ plugin: 'performance-budget', key: 'status' } as const, BUDGET_IDLE, {
  shape: 'status-1',
})

type Assets = { assets: string[]; rollbackFile: string }

function runnerOf($: EngineInterface): GitRunner {
  return async (argv) => {
    const result = await $.process.run(argv)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

async function assetsOf($: EngineInterface): Promise<Assets> {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath('release.json'))) as Partial<Assets>
    return {
      assets: Array.isArray(parsed.assets) ? parsed.assets.map(String) : [],
      rollbackFile: typeof parsed.rollbackFile === 'string' ? parsed.rollbackFile : 'ROLLBACK.md',
    }
  } catch {
    return { assets: [], rollbackFile: 'ROLLBACK.md' }
  }
}

/** Paths changed in the working tree or committed since the last tag (or the last commit). */
async function releaseChanges($: EngineInterface): Promise<string[]> {
  const run = runnerOf($)
  const dirty = ((await workingTreeChanges(run)) ?? []).map((change) => change.path)
  const tag = await run(['git', 'describe', '--tags', '--abbrev=0'])
  const base = tag.exitCode === 0 && tag.stdout.trim() !== '' ? tag.stdout.trim() : 'HEAD~1'
  const committed = (await changedBetween(run, base, 'HEAD')) ?? []
  return [...dirty, ...committed]
}

async function fileItem($: EngineInterface, path: string, label: string, detail: string) {
  // release.json lives in the repository, so its paths must stay inside it.
  if (isAbsolutePath(path) || hasParentSegment(path)) {
    return { label, ok: false, detail: `refused: ${path} is outside the repository` }
  }
  return { label, ok: await exists($, path), detail }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'release-gate',
      description: 'Release readiness: /release-gate check',
    })
    return next(e)
  })

  on('command.run', { command: 'release-gate' }, async ($, e) => {
    if (e.args.trim() !== 'check') return { text: 'Usage: /release-gate check' }
    const [ev, ct, rv, ar, mg, rd, bd] = await Promise.all([
      read($, evidence),
      read($, contract),
      read($, review),
      read($, architecture),
      read($, migration),
      read($, dependencies),
      read($, performance),
    ])
    const input: ReadinessInput = { contract: ct, evidence: ev, review: rv, architecture: ar }
    const readiness = assessReadiness(input)

    const changed = await releaseChanges($)
    const { assets, rollbackFile } = await assetsOf($)
    const items: Array<{ label: string; ok: boolean; detail: string }> = [
      {
        label: 'changelog updated',
        ok: changed.some((path) => /(^|\/)CHANGELOG\.md$/i.test(path)),
        detail: 'CHANGELOG.md changed since the last tag',
      },
      await fileItem($, rollbackFile, 'rollback documented', `${rollbackFile} exists`),
      ...(await Promise.all(
        assets.map((asset) => fileItem($, asset, `asset ${asset}`, 'listed in release.json')),
      )),
      {
        label: 'migrations reviewed',
        ok: mg.verdict === 'PASS',
        detail: `migration-sentinel: ${mg.verdict}`,
      },
      {
        label: 'dependencies reviewed',
        ok: rd.verdict === 'PASS',
        detail: `dependency-radar: ${rd.verdict}`,
      },
      {
        label: 'performance budgets',
        ok: bd.verdict === 'PASS',
        detail: `performance-budget: ${bd.verdict}`,
      },
    ]
    const checklistOk = items.every((item) => item.ok)
    const verdict: GateState['verdict'] =
      readiness.verdict === 'NOT READY'
        ? 'FAIL'
        : readiness.verdict === 'READY' && checklistOk
          ? 'PASS'
          : 'UNKNOWN'

    const lines = [
      `release: ${verdict} · readiness ${readiness.verdict}`,
      ...items.map((item) => `[${item.ok ? 'x' : ' '}] ${item.label}: ${item.detail}`),
    ]
    await $.fs.write(stateRelativePath('release/checklist.md'), `${lines.join('\n')}\n`)
    await update($, gate, () => ({
      verdict,
      phase: 'checked',
      reason: `readiness ${readiness.verdict}`,
    }))
    return { text: lines.join('\n') }
  })
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}
