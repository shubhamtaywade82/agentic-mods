import type { EngineInterface, On } from 'claude-code'
import { checkCommand, denyMessage } from './lib/blast'
import {
  denyReason,
  hasHighSignal,
  redact,
  scan,
  summarize,
} from './lib/secrets'
import {
  DEFAULT_DIFF_LIMIT,
  decideNoninteractive,
  diffStat,
  holdForBlast,
  holdForOversizedDiff,
  holdForSecretDiff,
  isHistoryMutating,
} from './lib/gate'

interface Stats {
  commandsBlocked: number
  commandsHeld: number
  commandsApproved: number
  secretsRedacted: number
  writesBlocked: number
  resultsRedacted: number
  kinds: Record<string, number>
}

const stats: Stats = {
  commandsBlocked: 0,
  commandsHeld: 0,
  commandsApproved: 0,
  secretsRedacted: 0,
  writesBlocked: 0,
  resultsRedacted: 0,
  kinds: {},
}

function mergeKinds(kinds: Record<string, number>): void {
  for (const [k, n] of Object.entries(kinds)) stats.kinds[k] = (stats.kinds[k] ?? 0) + n
}

async function requestApproval(
  _$: EngineInterface,
  _command: string,
  _reason: string,
  _preview: string,
): Promise<'approve' | 'deny'> {
  return 'deny'
}

async function gateHistoryCommand(
  $: EngineInterface,
  command: string,
): Promise<{ deny: string } | null> {
  let diffText = ''
  try {
    const res = await $.process.run(['git', 'diff', '--cached'])
    diffText = res.stdout ?? ''
  } catch {
    stats.commandsBlocked += 1
    return { deny: 'guardian: could not inspect the staged diff for secrets; refusing this commit/push. Stage the diff and retry.' }
  }

  if (diffText.length > DEFAULT_DIFF_LIMIT) {
    stats.commandsHeld += 1
    const held = holdForOversizedDiff(command, diffText.length, DEFAULT_DIFF_LIMIT)
    const decision = await requestApproval($, held.command, 'diff-oversized', held.preview)
    if (decision === 'approve') return null
    stats.commandsBlocked += 1
    return { deny: held.preview }
  }

  const findings = scan(diffText)
  if (findings.length === 0) return null

  if (hasHighSignal(findings)) {
    stats.commandsBlocked += 1
    const stat = diffStat(diffText)
    const held = holdForSecretDiff(
      command,
      findings.filter((f) => hasHighSignal([f])).map((f) => f.kind),
      stat,
    )
    return { deny: held.preview }
  }

  stats.commandsHeld += 1
  const stat = diffStat(diffText)
  const held = holdForSecretDiff(
    command,
    findings.map((f) => f.kind),
    stat,
  )
  const decision = await requestApproval($, held.command, 'diff-contains-secret', held.preview)
  if (decision === 'approve') {
    stats.commandsApproved += 1
    return null
  }
  stats.commandsBlocked += 1
  return { deny: decideNoninteractive(held) === 'approve' ? '' : held.preview }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guardian-report',
      description: 'Show what guardian has blocked, held or redacted this session',
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command: string = typeof e.command === 'string' ? e.command : ''

    const blast = checkCommand(command)
    if (blast) {
      stats.commandsHeld += 1
      const held = holdForBlast(command, blast)
      const decision = await requestApproval($, held.command, 'destructive-command', held.preview)
      if (decision === 'approve') {
        stats.commandsApproved += 1
        return next(e)
      }
      stats.commandsBlocked += 1
      return { deny: denyMessage(blast) }
    }

    const cmdFindings = scan(command)
    if (cmdFindings.length > 0) {
      mergeKinds(summarize(cmdFindings))
      if (denyReason(cmdFindings)) {
        stats.commandsBlocked += 1
        return { deny: denyReason(cmdFindings) ?? 'guardian: refusing this call' }
      }
      stats.secretsRedacted += cmdFindings.length
      return next({ ...e, command: redact(command, cmdFindings) })
    }

    if (isHistoryMutating(command)) {
      const gate = await gateHistoryCommand($, command)
      if (gate) return gate
    }

    return next(e)
  }).catch(async (_$) => {
    return { deny: 'guardian failed; refusing this call' }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const content: string = typeof e.content === 'string' ? e.content : ''
    const findings = scan(content)
    if (findings.length > 0) {
      if (hasHighSignal(findings)) {
        stats.writesBlocked += 1
        return { deny: denyReason(findings) ?? 'guardian: refusing this write' }
      }
      stats.secretsRedacted += findings.length
      mergeKinds(summarize(findings))
      return next({ ...e, content: redact(content, findings) })
    }
    return next(e)
  }).catch(async (_$) => {
    return { deny: 'guardian failed; refusing this write' }
  })

  on('command.run', { command: 'guardian-report' }, async () => {
    const kinds = Object.entries(stats.kinds)
      .map(([k, n]) => `${k} x${n}`)
      .join(', ')
    return {
      text:
        `guardian session report: ${stats.commandsBlocked} commands blocked, ` +
        `${stats.commandsHeld} held for approval (${stats.commandsApproved} approved), ` +
        `${stats.writesBlocked} writes blocked, ${stats.secretsRedacted} secrets redacted in calls/writes, ` +
        `${stats.resultsRedacted} secrets redacted in tool results` +
        (kinds ? ` (${kinds})` : ''),
    }
  })
}
