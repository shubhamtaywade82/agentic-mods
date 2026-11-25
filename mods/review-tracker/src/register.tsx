import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  type Finding,
  type FindingAction,
  gateFindings,
  stateRelativePath,
  transitionFinding,
  truncate,
} from '@agentic-mods/core'
import type { ReviewGate } from '../types'

const PANE = 'review-tracker'
const FILE = 'findings.json'
const ACTIONS: readonly FindingAction[] = ['start', 'fix', 'verify', 'reject', 'defer', 'reopen']
const SEVERITIES = ['high', 'medium', 'low'] as const

const IDLE: ReviewGate = {
  verdict: 'UNKNOWN',
  openHigh: 0,
  open: 0,
  reason: 'no review findings recorded',
}
const gate = atom({ plugin: 'review-tracker', key: 'gate' } as const, IDLE, { shape: 'gate-1' })

type Loaded = { ok: true; findings: Finding[] } | { ok: false; reason: string }

/** The recorded findings; a missing file is an empty list, an unreadable one is an error. */
async function loadFindings($: EngineInterface): Promise<Loaded> {
  const path = stateRelativePath(FILE)
  try {
    await $.fs.stat(path)
  } catch {
    return { ok: true, findings: [] }
  }
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(path))
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array')
    return { ok: true, findings: parsed as Finding[] }
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    // Refusing to continue keeps a later save from overwriting findings we could not read.
    return {
      ok: false,
      reason: `${path} cannot be read (${cause}). Repair or remove it; no finding was changed.`,
    }
  }
}

async function publishGate($: EngineInterface, findings: readonly Finding[]): Promise<void> {
  const result = gateFindings(findings)
  await update($, gate, () => ({
    verdict: result.verdict,
    openHigh: result.openHigh,
    open: result.open,
    reason: result.reason,
  }))
}

async function saveFindings($: EngineInterface, findings: readonly Finding[]): Promise<void> {
  await $.fs.write(stateRelativePath(FILE), `${JSON.stringify(findings, null, 2)}\n`)
  await publishGate($, findings)
}

function nextId(findings: readonly Finding[]): string {
  const highest = findings.reduce((max, finding) => {
    const number = Number(finding.id.replace(/^R-/, ''))
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0)
  return `R-${String(highest + 1).padStart(3, '0')}`
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'finding',
      description: 'Track review findings: /finding add|set|list',
    })
    const loaded = await loadFindings($)
    if (loaded.ok) await publishGate($, loaded.findings)
    return next(e)
  })

  on('command.run', { command: 'finding' }, async ($, e) => {
    const [subcommand = 'list', ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    const loaded = await loadFindings($)
    if (!loaded.ok) return { text: loaded.reason }
    const findings = loaded.findings

    if (subcommand === 'list') {
      await $.ui.open({ id: PANE, title: 'Review findings' })
      if (findings.length === 0) return { text: 'No findings recorded.' }
      return {
        text: findings
          .map((finding) => `${finding.id} ${finding.severity} ${finding.status} ${finding.title}`)
          .join('\n'),
      }
    }

    if (subcommand === 'add') {
      const severity = rest[0]
      const title = rest.slice(1).join(' ').trim()
      if (!SEVERITIES.some((value) => value === severity) || title === '') {
        return { text: 'Usage: /finding add high|medium|low <title>' }
      }
      const finding: Finding = {
        id: nextId(findings),
        title: truncate(title, 300),
        severity: severity as Finding['severity'],
        status: 'open',
        file: null,
        reason: null,
        evidence: null,
        updatedAt: await $.clock.now(),
      }
      await saveFindings($, [...findings, finding])
      return { text: `${finding.id} recorded as ${finding.severity}.` }
    }

    if (subcommand === 'set') {
      const [id = '', action = '', ...detail] = rest
      const target = findings.find((finding) => finding.id === id)
      const transition = ACTIONS.find((value) => value === action)
      if (target === undefined || transition === undefined) {
        return { text: `Usage: /finding set <id> ${ACTIONS.join('|')} [text]` }
      }
      const text = truncate(detail.join(' ').trim(), 1000)
      const result = transitionFinding(target.status, transition, {
        evidence: transition === 'verify' ? text : null,
        reason: transition === 'reject' || transition === 'defer' ? text : null,
      })
      if (!result.ok) return { text: result.reason }
      const updated: Finding = {
        ...target,
        status: result.status,
        evidence: transition === 'verify' ? text : target.evidence,
        reason: transition === 'reject' || transition === 'defer' ? text : target.reason,
        updatedAt: await $.clock.now(),
      }
      await saveFindings(
        $,
        findings.map((finding) => (finding.id === id ? updated : finding)),
      )
      return { text: `${id} is now ${result.status}.` }
    }

    return { text: 'Usage: /finding add|set|list' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, gate)
    return (
      <Box flexDirection="column">
        <Text>
          Review gate: {current.verdict} · {current.reason}
        </Text>
        <Text dimColor>Use /finding add, /finding set and /finding list.</Text>
      </Box>
    )
  })
}
