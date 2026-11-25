import { atom, update } from 'claude-code'
import type { On } from 'claude-code'

import { normalizePath, truncate, validateSpec } from '@agentic-mods/core'
import type { GateState } from '../types'

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no specification checked' }
const gate = atom({ plugin: 'specification-guard', key: 'gate' } as const, IDLE, { shape: 'gate-1' })

const TEMPLATE = [
  'Feature: <name>',
  '',
  '  Scenario: <behaviour in one line>',
  '    Given <starting state>',
  '    When <action>',
  '    Then <observable result>',
  '',
  'Non-functional requirements:',
  '- performance: <budget>',
  '- security: <requirement>',
  '- compatibility: <what must keep working>',
  '- observability: <what must be logged or measured>',
  '- rollback: <how to revert>',
].join('\n')

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spec',
      description: 'Check acceptance criteria: /spec check <path> | /spec template',
    })
    return next(e)
  })

  on('command.run', { command: 'spec' }, async ($, e) => {
    const [subcommand = '', ...rest] = e.args.trim().split(/\s+/).filter(word => word.length > 0)
    if (subcommand === 'template') return { text: TEMPLATE }
    if (subcommand !== 'check' || rest.length === 0) {
      return { text: 'Usage: /spec check <path to the specification> | /spec template' }
    }
    const path = normalizePath(rest.join(' '))
    let text: string
    try {
      text = await $.fs.read(path)
    } catch {
      return { text: `Cannot read ${path}. Check the path, relative to the repository root.` }
    }
    const report = validateSpec(text)
    await update($, gate, () => ({
      verdict: report.verdict,
      phase: 'specified',
      reason: truncate(`${report.scenarios} scenario(s), ${report.issues.length} issue(s) in ${path}`, 200),
    }))
    const lines = [
      `specification: ${report.verdict} (${report.scenarios} scenario(s))`,
      ...report.issues.map(issue => `line ${issue.line}: ${issue.message}`),
      ...(report.missingSections.length > 0 ? [`missing sections: ${report.missingSections.join(', ')}`] : []),
    ]
    return { text: lines.join('\n') }
  })
}
