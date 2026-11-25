import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { assessReadiness, describeEvidence, type ReadinessInput } from '@agentic-mods/core'
import type { EvidenceStatus } from '../../evidence-gate/types'
import type { ContractStatus } from '../../change-contract/types'
import type { ReviewGate } from '../../review-tracker/types'
import type { ArchitectureStatus } from '../../architecture-guard/types'

const PANE = 'pr-readiness'

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const CONTRACT_IDLE: ContractStatus = { active: false, objective: '', violations: 0, mode: 'warn' }
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

// Read-only views of the states other mods publish.
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

async function inputOf($: EngineInterface): Promise<ReadinessInput> {
  const [ev, ct, rv, ar] = await Promise.all([
    read($, evidence),
    read($, contract),
    read($, review),
    read($, architecture),
  ])
  return { contract: ct, evidence: ev, review: rv, architecture: ar }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pr-ready',
      description:
        'Readiness verdict for the change; /pr-ready description drafts the PR verification section',
    })
    return next(e)
  })

  on('command.run', { command: 'pr-ready' }, async ($, e) => {
    const input = await inputOf($)
    if (e.args.trim() === 'description') {
      return { text: describeEvidence(input) }
    }
    const result = assessReadiness(input)
    await $.ui.open({ id: PANE, title: 'PR readiness' })
    const lines = [
      `PR readiness: ${result.verdict}`,
      ...result.items.map(
        (item) => `${item.label.padEnd(13)} ${item.verdict.padEnd(8)} ${item.detail}`,
      ),
    ]
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const result = assessReadiness(await inputOf($))
    return (
      <Box flexDirection="column">
        <Text>Release readiness: {result.verdict}</Text>
        {result.items.map((item) => (
          <Text key={item.label}>
            {item.label}: {item.verdict} · {item.detail}
          </Text>
        ))}
      </Box>
    )
  })
}
