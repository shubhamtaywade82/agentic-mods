import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { EvidenceStatus } from '../../evidence-gate/types'
import { band } from '../../../packages/core/src/ui'

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const evidence = atom({ plugin: 'evidence-gate', key: 'status' } as const, EVIDENCE_IDLE, {
  shape: 'status-1',
})

export function register(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, evidence)
    const test = state.checks.find((item) => item.check === 'test')
    if (test === undefined || test.verdict === 'UNKNOWN') return next(e)
    const kit = $.ui.resolve(e)
    if (test.verdict === 'PASS') {
      return band(kit, 'boss', [
        { text: '☠ defeated', tone: 'success', bold: true },
        { text: 'tests are current and passing', tone: 'subtle' },
      ])
    }
    return band(kit, 'boss', [
      { text: '👾 standing', tone: 'error', bold: true },
      { text: `test check ${test.verdict.toLowerCase()}`, tone: 'warning' },
      { text: test.reason, tone: 'subtle' },
    ])
  })
}
