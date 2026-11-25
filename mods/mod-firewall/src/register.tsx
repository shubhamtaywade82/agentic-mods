import type { EngineInterface, On } from 'claude-code'

import {
  appendJsonLine,
  auditLine,
  isTrustedMod,
  loadConfig,
  stateRelativePath,
  truncate,
} from '@agentic-mods/core'

const PLUGIN = 'mod-firewall'
const AUDIT_CAP = 500

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function executableOf(argv: readonly string[]): string {
  return (argv[0] ?? '').replace(/^.*\//, '')
}

async function audit($: EngineInterface, record: Record<string, unknown>): Promise<void> {
  const path = stateRelativePath('audit/firewall.jsonl')
  let existing: string
  try {
    existing = await $.fs.read(path)
  } catch {
    existing = ''
  }
  await $.fs.write(path, appendJsonLine(existing, auditLine(record, Date.now()), AUDIT_CAP))
}

/** Decides an outbound target. Engine-originated and own requests always pass. */
async function decide(
  $: EngineInterface,
  kind: 'http' | 'process',
  origin: string,
  target: string,
  allowed: readonly string[],
): Promise<string | null> {
  if (origin === 'engine' || isTrustedMod(origin)) return null
  const config = (await loadConfig(path => $.fs.read(path))).value.firewall
  const isAllowed = allowed.includes(target)
  await audit($, { plugin: PLUGIN, kind, origin, target, allowed: isAllowed, mode: config.mode })
  if (isAllowed || config.mode === 'observe') return null
  const message = `mod-firewall: ${origin} may not ${kind === 'http' ? 'reach' : 'start'} ${target}. Add it to .agentic-mods/config.json under firewall to allow it.`
  if (config.mode === 'warn') {
    $.ui.toast(truncate(message, 180))
    return null
  }
  return message
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'firewall',
      description: "Show recent network and process decisions made for other mods",
    })
    return next(e)
  })

  on('command.run', { command: 'firewall' }, async $ => {
    const path = stateRelativePath('audit/firewall.jsonl')
    try {
      const lines = (await $.fs.read(path)).split('\n').filter(line => line.length > 0)
      return { text: lines.slice(-20).join('\n') || 'No decisions recorded yet.' }
    } catch {
      return { text: 'No decisions recorded yet.' }
    }
  })

  on('http.fetch', async ($, e, next) => {
    const denial = await decide(
      $,
      'http',
      next.origin.plugin,
      hostOf(e.url),
      (await loadConfig(path => $.fs.read(path))).value.firewall.allowHosts,
    )
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'mod-firewall failed closed on an outbound request.' },
  )

  on('process.run', async ($, e, next) => {
    const denial = await decide(
      $,
      'process',
      next.origin.plugin,
      executableOf(e.argv),
      (await loadConfig(path => $.fs.read(path))).value.firewall.allowProcesses,
    )
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'mod-firewall failed closed on a process launch.' },
  )
}
