import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { truncate, registerCommand } from '@agentic-mods/core'
import type { GateState } from '../types'

type Defect = Record<string, string>

const FIELDS = [
  'symptom',
  'repro',
  'expected',
  'actual',
  'hypothesis',
  'evidence',
  'root-cause',
  'fix',
  'regression-test',
  'risk',
  'impossible',
] as const

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no defect open' }
const gate = atom({ plugin: 'defect-protocol', key: 'gate' } as const, IDLE, { shape: 'gate-1' })
const defect = atom({ plugin: 'defect-protocol', key: 'defect' } as const, {} as Defect, {
  shape: 'defect-1',
})

type DefectGate = { gate: GateState; fields: Defect }

/** Reproduction is documented or declared impossible; a fix needs a fix and a regression test. */
function gateOf(fields: Defect): GateState {
  const reproduced = (fields['repro'] ?? '') !== '' || (fields['impossible'] ?? '') !== ''
  const fixed = (fields['fix'] ?? '') !== '' && (fields['regression-test'] ?? '') !== ''
  if (fixed) return { verdict: 'PASS', phase: 'fixed', reason: 'fix and regression test recorded' }
  if (reproduced) return { verdict: 'PASS', phase: 'reproduced', reason: 'reproduction recorded' }
  return { verdict: 'UNKNOWN', phase: 'open', reason: 'no reproduction or impossibility reason' }
}

async function publish(fields: Defect): Promise<DefectGate> {
  return { gate: gateOf(fields), fields }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'defect',
      description:
        'Defect protocol: /defect open <title>, /defect set <field> <text>, /defect status',
    })
    return next(e)
  })

  on('command.run', { command: 'defect' }, async ($, e) => {
    const [subcommand = 'status', ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    const current = await read($, defect)

    if (subcommand === 'open') {
      const title = rest.join(' ').trim()
      if (title === '') return { text: 'Usage: /defect open <title>' }
      const fields: Defect = { title: truncate(title, 200) }
      await update($, defect, () => fields)
      await update($, gate, () => gateOf(fields))
      return { text: `Defect opened: ${title}. Record the symptom and the reproduction next.` }
    }

    if (subcommand === 'set') {
      const field = rest[0] ?? ''
      const text = rest.slice(1).join(' ').trim()
      if (!(FIELDS as readonly string[]).includes(field) || text === '') {
        return { text: `Usage: /defect set <${FIELDS.join('|')}> <text>` }
      }
      const fields: Defect = { ...current, [field]: truncate(text, 2000) }
      await update($, defect, () => fields)
      await update($, gate, () => gateOf(fields))
      return { text: `${field} recorded.` }
    }

    const result = await publish(current)
    return {
      text: [
        `defect: ${result.gate.phase} (${result.gate.verdict})`,
        ...Object.entries(current).map(([key, value]) => `${key}: ${value}`),
      ].join('\n'),
    }
  })
}
