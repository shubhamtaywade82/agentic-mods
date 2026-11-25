import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { EvidenceStatus } from '../../evidence-gate/types'
import type { Mood } from '../types'

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const evidence = atom({ plugin: 'evidence-gate', key: 'status' } as const, EVIDENCE_IDLE, {
  shape: 'status-1',
})
const mood = atom({ plugin: 'code-pet', key: 'mood' } as const, 'idle' as Mood, { shape: 'mood-1' })

const FACES: Readonly<Record<Mood, string>> = {
  idle: '(-_-)',
  content: '(^_^)',
  busy: '(>_<)',
  worried: '(;_;)',
}

export function register(on: On): void {
  on('turn.start', async ($, e, next) => {
    await $.store.set('calls', 0)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await $.store.set('calls', Number((await $.store.get('calls')) ?? 0) + 1)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const calls = Number((await $.store.get('calls')) ?? 0)
    const state = await read($, evidence)
    const nextMood: Mood =
      state.overall === 'FAIL'
        ? 'worried'
        : state.overall === 'PASS'
          ? 'content'
          : calls > 20
            ? 'busy'
            : 'idle'
    await update($, mood, () => nextMood)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, _next) => {
    const current = await read($, mood)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          {FACES[current]} code-pet is {current}
        </Text>
      </Box>
    )
  })
}
