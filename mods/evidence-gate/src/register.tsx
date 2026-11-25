import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  type AgenticConfig,
  analyzeCommand,
  appendCapped,
  CHECKS,
  type CheckName,
  type CheckRecord,
  type CheckStatus,
  currentHead,
  describeDecision,
  evaluateChecks,
  type GitRunner,
  fingerprintFiles,
  gateDecision,
  isCheckName,
  loadConfig,
  overallVerdict,
  type Verdict,
  workingTreeChanges,
  registerCommand,
} from '@agentic-mods/core'
import type { EvidenceStatus } from '../types'
import { band, card, chip, empty, header, verdictLook } from '../../../packages/core/src/ui'

const PANE = 'evidence-gate'
const MAX_RECORDS = 50
const MAX_TIMEOUT_MS = 600_000

const IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const status = atom({ plugin: 'evidence-gate', key: 'status' } as const, IDLE, {
  shape: 'status-1',
})

type Snapshot = {
  config: AgenticConfig
  configured: boolean
  statuses: CheckStatus[]
  overall: Verdict
  fingerprint: string | null
}

function runnerOf($: EngineInterface): GitRunner {
  return async (argv) => {
    const result = await $.process.run(argv)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

async function readOrNull($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

/** HEAD plus every uncommitted path and its content. Null when git cannot answer. */
async function repoFingerprint($: EngineInterface): Promise<string | null> {
  const run = runnerOf($)
  const head = await currentHead(run)
  const changes = await workingTreeChanges(run)
  if (changes === null) return null
  const entries: Array<[string, string | null]> = [['HEAD', head]]
  for (const change of changes) {
    entries.push([change.path, await readOrNull($, change.path)])
  }
  return fingerprintFiles(entries)
}

async function storedRecords($: EngineInterface): Promise<CheckRecord[]> {
  const value = await $.store.get('records')
  return Array.isArray(value) ? (value as CheckRecord[]) : []
}

function latestByCheck(records: readonly CheckRecord[]): Map<CheckName, CheckRecord> {
  const latest = new Map<CheckName, CheckRecord>()
  for (const record of records) latest.set(record.check, record)
  return latest
}

async function snapshotOf($: EngineInterface): Promise<Snapshot> {
  const config = (await loadConfig((path) => $.fs.read(path))).value
  const fingerprint = await repoFingerprint($)
  const statuses = evaluateChecks(
    config.evidence.required,
    latestByCheck(await storedRecords($)),
    fingerprint,
    await $.clock.now(),
    config.evidence.maxAgeMinutes * 60_000,
  )
  const configured = Object.values(config.evidence.commands).some(
    (list) => Array.isArray(list) && list.length > 0,
  )
  return { config, configured, statuses, overall: overallVerdict(statuses), fingerprint }
}

async function publish($: EngineInterface, snap: Snapshot): Promise<void> {
  await update($, status, () => ({
    overall: snap.overall,
    fingerprint: snap.fingerprint,
    checks: snap.statuses.map((item) => ({
      check: item.check,
      verdict: item.verdict,
      reason: item.reason,
      ranAt: item.record?.ranAt ?? null,
    })),
  }))
}

/** Runs each configured argv for one check in order; stops at the first non-zero exit. */
async function runCheck(
  $: EngineInterface,
  config: AgenticConfig,
  check: CheckName,
): Promise<CheckRecord> {
  const commands = config.evidence.commands[check] ?? []
  const startedAt = await $.clock.now()
  const timeoutMs = Math.min(config.evidence.runTimeoutMs, MAX_TIMEOUT_MS)
  let exitCode: number | null = commands.length === 0 ? null : 0
  for (const argv of commands) {
    try {
      const result = await $.process.run(argv, { timeoutMs })
      if (result.exitCode !== 0) {
        exitCode = result.exitCode
        break
      }
    } catch {
      exitCode = null
      break
    }
  }
  const endedAt = await $.clock.now()
  return {
    check,
    argv: commands[0] ?? [],
    exitCode,
    fingerprint: await repoFingerprint($),
    ranAt: endedAt,
    durationMs: endedAt - startedAt,
    source: 'run',
  }
}

function summaryOf(snap: Snapshot): string {
  const lines = snap.statuses.map((item) => `${item.check}: ${item.verdict} (${item.reason})`)
  const notice = snap.configured
    ? []
    : ['No evidence commands are configured in .agentic-mods/config.json, so git gates only warn.']
  return [`evidence: ${snap.overall}`, ...lines, ...notice].join('\n')
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'evidence',
      description: 'Show or run the verification checks: /evidence [run [check...] | clear]',
    })
    return next(e)
  })

  on('command.run', { command: 'evidence' }, async ($, e) => {
    const [subcommand = 'status', ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)

    if (subcommand === 'clear') {
      await $.store.set('records', [])
      await publish($, await snapshotOf($))
      return { text: 'Recorded evidence cleared.' }
    }

    if (subcommand === 'run') {
      const requested = rest.filter(isCheckName)
      const before = await snapshotOf($)
      const targets = requested.length > 0 ? requested : before.config.evidence.required
      let records = await storedRecords($)
      for (const check of targets) {
        const record = await runCheck($, before.config, check)
        records = appendCapped(records, record, MAX_RECORDS)
        await $.store.set('records', records)
      }
      const after = await snapshotOf($)
      await publish($, after)
      return { text: summaryOf(after) }
    }

    if (subcommand === 'status') {
      const snap = await snapshotOf($)
      await publish($, snap)
      await $.ui.open({ id: PANE, title: 'Evidence' })
      return { text: summaryOf(snap) }
    }

    return { text: `Usage: /evidence [run [${CHECKS.join('|')}...] | clear]` }
  })

  // Gated git actions. The check runs before the command, so a stale result cannot pass.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const actions = analyzeCommand(e.command).gitActions
    if (actions.length === 0) return next(e)
    const snap = await snapshotOf($)
    await publish($, snap)
    for (const action of actions) {
      // Without configured commands no check can ever pass, so enforcing would refuse every commit.
      const mode = snap.configured ? snap.config.evidence.gateMode : 'warn'
      const decision = gateDecision(action, snap.statuses, mode)
      if (decision.decision === 'block') return { deny: describeDecision(decision) }
      if (decision.decision === 'warn') $.ui.toast(describeDecision(decision))
    }
    return next(e)
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : { deny: 'evidence-gate failed closed: the gated action was not checked.' },
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, status)
    if (current.checks.length === 0) return next(e)
    const kit = $.ui.resolve(e)
    return band(
      kit,
      'evidence',
      current.checks.map((item) => {
        const look = verdictLook(item.verdict)
        return { text: `${look.glyph} ${item.check}`, tone: look.tone }
      }),
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const current = await read($, status)
    if (current.checks.length === 0) {
      return empty(kit, 'No checks configured or run yet.', '/evidence run')
    }
    return (
      <Box flexDirection="column">
        {header(kit, {
          title: 'Evidence',
          meta: `${current.checks.length} check(s)`,
          badge: chip(kit, current.overall, verdictLook(current.overall)),
        })}
        {current.checks.map((item) =>
          card(kit, {
            key: item.check,
            title: `${item.check}  ${item.verdict}`,
            look: verdictLook(item.verdict),
            lines: [item.reason],
          }),
        )}
        <Text dimColor>Commit, push and PR are gated on these checks.</Text>
      </Box>
    )
  })
}
