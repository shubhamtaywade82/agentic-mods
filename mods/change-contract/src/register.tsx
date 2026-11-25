import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  allowed,
  appendCapped,
  type ContractSpec,
  contractDecision,
  type Decision,
  describeDecision,
  loadConfig,
  normalizePath,
  parseContractJson,
  stateRelativePath,
} from '@agentic-mods/core'
import type { ContractStatus } from '../types'

const MAX_VIOLATIONS = 50
const IDLE: ContractStatus = { active: false, objective: '', violations: 0, mode: 'warn' }
const status = atom({ plugin: 'change-contract', key: 'status' } as const, IDLE, {
  shape: 'status-1',
})

function isActive(spec: ContractSpec): boolean {
  return spec.objective.trim() !== '' || spec.allowed.length > 0 || spec.forbidden.length > 0
}

/** The contract file when it is valid, otherwise the configured contract. */
async function loadContract($: EngineInterface): Promise<ContractSpec> {
  const configured = (await loadConfig((path) => $.fs.read(path))).value.contract
  let fromFile: ContractSpec | null
  try {
    fromFile = parseContractJson(await $.fs.read(stateRelativePath('contract.json')))
  } catch {
    fromFile = null
  }
  return fromFile ?? { ...configured }
}

async function saveContract($: EngineInterface, spec: ContractSpec): Promise<void> {
  await $.fs.write(stateRelativePath('contract.json'), `${JSON.stringify(spec, null, 2)}\n`)
  await update($, status, (current) => ({
    ...current,
    active: isActive(spec),
    objective: spec.objective,
    mode: spec.mode,
  }))
}

async function judge($: EngineInterface, path: string): Promise<Decision> {
  const spec = await loadContract($)
  if (!isActive(spec)) return allowed('change-contract')
  return contractDecision(spec, path)
}

async function recordViolation($: EngineInterface, decision: Decision): Promise<void> {
  const list = await $.store.get('violations')
  const existing = Array.isArray(list) ? (list as string[]) : []
  const next = appendCapped(
    existing,
    `${new Date().toISOString()} ${describeDecision(decision)}`,
    MAX_VIOLATIONS,
  )
  await $.store.set('violations', next)
  await update($, status, (current) => ({ ...current, violations: next.length }))
}

async function guardWrite($: EngineInterface, path: string): Promise<string | null> {
  const decision = await judge($, normalizePath(path))
  if (decision.decision === 'allow') return null
  await recordViolation($, decision)
  if (decision.decision === 'block') return describeDecision(decision)
  $.ui.toast(describeDecision(decision))
  return null
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'contract',
      description:
        'Show, set or amend the change contract: /contract show|set|allow|forbid|mode|violations|close',
    })
    return next(e)
  })

  on('command.run', { command: 'contract' }, async ($, e) => {
    const [subcommand = 'show', ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    const text = rest.join(' ')
    const spec = await loadContract($)

    switch (subcommand) {
      case 'show':
        return {
          text: [
            `objective: ${spec.objective || 'not set'}`,
            `allowed: ${spec.allowed.join(', ') || 'anything not forbidden'}`,
            `forbidden: ${spec.forbidden.join(', ') || 'none'}`,
            `mode: ${spec.mode}`,
          ].join('\n'),
        }
      case 'set':
        if (text === '') return { text: 'Usage: /contract set <objective>' }
        await saveContract($, { ...spec, objective: text })
        return { text: 'Objective recorded.' }
      case 'allow':
        if (rest.length === 0) return { text: 'Usage: /contract allow <glob...>' }
        await saveContract($, { ...spec, allowed: [...new Set([...spec.allowed, ...rest])] })
        return { text: `Allowed paths now: ${rest.join(', ')} added.` }
      case 'forbid':
        if (rest.length === 0) return { text: 'Usage: /contract forbid <glob...>' }
        await saveContract($, { ...spec, forbidden: [...new Set([...spec.forbidden, ...rest])] })
        return { text: `Forbidden paths: ${rest.join(', ')} added.` }
      case 'mode': {
        const mode = rest[0]
        if (mode !== 'observe' && mode !== 'warn' && mode !== 'enforce') {
          return { text: 'Usage: /contract mode observe|warn|enforce' }
        }
        await saveContract($, { ...spec, mode })
        return { text: `Contract mode: ${mode}.` }
      }
      case 'violations': {
        const list = await $.store.get('violations')
        const rows = Array.isArray(list) ? (list as string[]) : []
        return { text: rows.slice(-20).join('\n') || 'No contract violations recorded.' }
      }
      case 'close':
        await saveContract($, { objective: '', allowed: [], forbidden: [], mode: spec.mode })
        return { text: 'Contract closed.' }
      default:
        return { text: 'Usage: /contract show|set|allow|forbid|mode|violations|close' }
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const denial = await guardWrite($, e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'change-contract failed closed on Edit.' },
  )

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const denial = await guardWrite($, e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'change-contract failed closed on Write.' },
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, status)
    if (!current.active || current.violations === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>
          contract {current.mode}: {current.violations} write{current.violations === 1 ? '' : 's'}{' '}
          outside scope
        </Text>
      </Box>
    )
  })
}
