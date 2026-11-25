import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { normalizePath, stateRelativePath, truncate } from '@agentic-mods/core'
import type { GateState } from '../types'

type Plan = {
  objective: string
  files: string[]
  tests: string[]
  risks: string
}

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no plan recorded' }
const gate = atom({ plugin: 'change-planner', key: 'gate' } as const, IDLE, { shape: 'gate-1' })

async function loadPlan($: EngineInterface): Promise<Plan | null> {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath('plan.json'))) as Partial<Plan>
    return {
      objective: String(parsed.objective ?? ''),
      files: Array.isArray(parsed.files) ? parsed.files.map(String) : [],
      tests: Array.isArray(parsed.tests) ? parsed.tests.map(String) : [],
      risks: String(parsed.risks ?? ''),
    }
  } catch {
    return null
  }
}

function verdictOf(plan: Plan): GateState['verdict'] {
  return plan.files.length > 0 && plan.tests.length > 0 && plan.risks.trim() !== '' ? 'PASS' : 'UNKNOWN'
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'change-plan',
      description: 'Change plan: /change-plan set <objective> | <files> | <tests> | <risks>, /change-plan show, /change-plan contract',
    })
    return next(e)
  })

  on('command.run', { command: 'change-plan' }, async ($, e) => {
    const [subcommand = 'show', ...rest] = e.args.trim().split(/\s+/).filter(word => word.length > 0)

    if (subcommand === 'set') {
      const [objective = '', files = '', tests = '', risks = ''] = rest.join(' ').split('|').map(part => part.trim())
      if (objective === '' || files === '' || tests === '' || risks === '') {
        return { text: 'Usage: /plan set <objective> | <comma-separated files> | <comma-separated tests> | <risks>' }
      }
      const plan: Plan = {
        objective: truncate(objective, 300),
        files: files.split(',').map(path => normalizePath(path)).filter(path => path !== ''),
        tests: tests.split(',').map(path => normalizePath(path)).filter(path => path !== ''),
        risks: truncate(risks, 1000),
      }
      await $.fs.write(stateRelativePath('plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
      await update($, gate, () => ({
        verdict: verdictOf(plan),
        phase: 'planned',
        reason: `${plan.files.length} file(s), ${plan.tests.length} test(s)`,
      }))
      return { text: `Plan recorded: ${plan.files.length} file(s), ${plan.tests.length} test(s).` }
    }

    const plan = await loadPlan($)
    if (plan === null) return { text: 'No plan recorded. Use /change-plan set first.' }

    if (subcommand === 'contract') {
      const contract = { objective: plan.objective, allowed: plan.files, forbidden: [], mode: 'warn' }
      await $.fs.write(stateRelativePath('contract.json'), `${JSON.stringify(contract, null, 2)}\n`)
      return { text: `Change contract written: ${plan.files.length} allowed path(s), mode warn.` }
    }

    return {
      text: [
        `objective: ${plan.objective}`,
        `files: ${plan.files.join(', ')}`,
        `tests: ${plan.tests.join(', ')}`,
        `risks: ${plan.risks}`,
      ].join('\n'),
    }
  })
}
