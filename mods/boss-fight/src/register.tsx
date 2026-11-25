import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { EvidenceStatus } from '../../evidence-gate/types'

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const evidence = atom({ plugin: 'evidence-gate', key: 'status' } as const, EVIDENCE_IDLE, { shape: 'status-1' })

export function register(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, evidence)
    const test = state.checks.find(item => item.check === 'test')
    if (test === undefined || test.verdict === 'UNKNOWN') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (test.verdict === 'PASS') {
      return (
        <Box>
          <Text dimColor>boss: defeated · tests are current and passing</Text>
        </Box>
      )
    }
    return (
      <Box>
        <Text>boss: standing · test check {test.verdict.toLowerCase()} · {test.reason}</Text>
      </Box>
    )
  })
}
