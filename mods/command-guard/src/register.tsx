import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  analyzeCommand,
  secretFileReads,
  type GuardTier,
  isProtectedPath,
  loadConfig,
  type AgenticConfig,
  sortDangers,
  shortCode,
  stateRelativePath,
  auditLine,
  appendJsonLine,
} from '@agentic-mods/core'

const PLUGIN = 'command-guard'
const TIER_ORDER: readonly GuardTier[] = ['preview-only', 'button', 'typed-code', 'always-block']

/** The incident profile owned by incident-timeline. Read only: this mod never writes it. */
const incident = atom(
  { plugin: 'incident-timeline', key: 'incident' } as const,
  { isOpen: false, profile: 'standard' as const, id: null as string | null },
  { shape: 'incident-1' },
)

type Judgement = { kind: 'allow' } | { kind: 'deny'; text: string }

const ALLOW: Judgement = { kind: 'allow' }

function stricter(a: GuardTier, b: GuardTier): GuardTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b
}

async function configOf($: EngineInterface): Promise<AgenticConfig> {
  const loaded = await loadConfig(path => $.fs.read(path))
  return loaded.value
}

async function blockedCount($: EngineInterface): Promise<number> {
  return Number((await $.store.get('blocked')) ?? 0)
}

async function recordBlock($: EngineInterface, tool: string, reason: string): Promise<void> {
  await $.store.set('blocked', (await blockedCount($)) + 1)
  const path = stateRelativePath('audit/command-guard.jsonl')
  let existing = ''
  try {
    existing = await $.fs.read(path)
  } catch {
    existing = ''
  }
  await $.fs.write(
    path,
    appendJsonLine(existing, auditLine({ plugin: PLUGIN, tool, decision: 'deny', reason }, Date.now()), 500),
  )
}

async function judgeCommand($: EngineInterface, command: string): Promise<Judgement> {
  const analysis = analyzeCommand(command)
  const [top] = sortDangers(analysis.dangers)
  if (top === undefined) return ALLOW
  if (top.level === 'always-block') {
    return { kind: 'deny', text: `command-guard: refused, ${top.reason}. The command was not run.` }
  }

  const config = await configOf($)
  const state = await read($, incident)
  let tier = config.guard.confirmTier
  if (state.isOpen) tier = stricter(tier, 'typed-code')

  const reasons = analysis.dangers.map(hit => hit.reason).join('; ')
  switch (tier) {
    case 'always-block':
      return { kind: 'deny', text: `command-guard: this tier never runs confirm-level commands. ${reasons}.` }
    case 'preview-only':
      return {
        kind: 'deny',
        text: `command-guard: held for the person, not run. Command: ${command}. Reason: ${reasons}.`,
      }
    case 'button': {
      const answer = await $.ui.ask(`Run this command? ${command}\nReason: ${reasons}`, ['Proceed', 'Cancel'])
      return answer === 'Proceed' ? ALLOW : { kind: 'deny', text: 'command-guard: cancelled by the person.' }
    }
    case 'typed-code': {
      const code = await shortCode(command, 6)
      const answer = await $.ui.ask(`${reasons}\nTo run it, type ${code}. Command: ${command}`)
      return answer.trim().toUpperCase() === code
        ? ALLOW
        : { kind: 'deny', text: 'command-guard: the confirmation code did not match; nothing ran.' }
    }
  }
}

async function protectedDenial($: EngineInterface, tool: string, path: string): Promise<string | null> {
  const config = await configOf($)
  if (!isProtectedPath(path, config.guard.protectedPaths, config.guard.protectedExceptions)) return null
  const text = `command-guard: ${path} is a protected secret file. Change it yourself, or add an exception in .agentic-mods/config.json.`
  await recordBlock($, tool, text)
  return text
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard',
      description: "Show command-guard's settings, config problems and blocks this session",
    })
    return next(e)
  })

  on('command.run', { command: 'guard' }, async $ => {
    const loaded = await loadConfig(path => $.fs.read(path))
    const lines = [
      `command-guard: confirm tier ${loaded.value.guard.confirmTier}`,
      `blocked this session: ${await blockedCount($)}`,
      ...loaded.errors.map(message => `config: ${message}`),
    ]
    return { text: lines.join('\n') }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const config = await configOf($)
    const reads = secretFileReads(e.command, config.guard.protectedPaths, config.guard.protectedExceptions)
    if (reads.length > 0) {
      const text = `command-guard: ${reads.join(', ')} is a protected secret file and this command would read it. Read it yourself, or add an exception in .agentic-mods/config.json.`
      await recordBlock($, 'Bash', text)
      return { deny: text }
    }
    const judgement = await judgeCommand($, e.command)
    if (judgement.kind === 'deny') {
      await recordBlock($, 'Bash', judgement.text)
      return { deny: judgement.text }
    }
    return next(e)
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'command-guard failed closed: the command was not judged.' },
  )

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const denial = await protectedDenial($, 'Edit', e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: 'command-guard failed closed on Edit.' }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const denial = await protectedDenial($, 'Write', e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: 'command-guard failed closed on Write.' }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const denial = await protectedDenial($, 'Read', e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: 'command-guard failed closed on Read.' }))
}
