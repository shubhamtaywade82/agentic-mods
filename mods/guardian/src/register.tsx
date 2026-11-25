import type { EngineInterface, On } from 'claude-code'
import { checkCommand } from './lib/blast'
import { denyReason, hasHighSignal, redact, redactResult, scan, summarize } from './lib/secrets'
import {
  DEFAULT_DIFF_LIMIT,
  diffStat,
  holdForBlast,
  holdForOversizedDiff,
  holdForSecretDiff,
  isHistoryMutating,
} from './lib/gate'
import { registerCommand } from '@agentic-mods/core'

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

type Verdict = { decision: 'ask' | 'deny'; reason: string }

// Commands held for the person, by tool_use_id; one that reaches tool.call was approved.
const heldCalls = new Set<string>()

/** The staged diff of a commit or push: refused if it holds a high-signal secret, held otherwise. */
async function gateHistoryCommand($: EngineInterface, command: string): Promise<Verdict | null> {
  let diffText: string
  try {
    const res = await $.process.run(['git', 'diff', '--cached'])
    diffText = res.stdout ?? ''
  } catch {
    return {
      decision: 'deny',
      reason:
        'guardian: could not inspect the staged diff for secrets; refusing this commit/push. Stage the diff and retry.',
    }
  }
  if (diffText.length > DEFAULT_DIFF_LIMIT) {
    return {
      decision: 'ask',
      reason: holdForOversizedDiff(command, diffText.length, DEFAULT_DIFF_LIMIT).preview,
    }
  }
  const findings = scan(diffText)
  if (findings.length === 0) return null
  const highSignal = findings.filter((f) => hasHighSignal([f]))
  const kinds = (highSignal.length > 0 ? highSignal : findings).map((f) => f.kind)
  const preview = holdForSecretDiff(command, kinds, diffStat(diffText)).preview
  return { decision: highSignal.length > 0 ? 'deny' : 'ask', reason: preview }
}

/** guardian's verdict on a Bash command before it runs, or null to leave it to the others. */
async function verdictFor($: EngineInterface, command: string): Promise<Verdict | null> {
  const blast = checkCommand(command)
  if (blast) return { decision: 'ask', reason: holdForBlast(command, blast).preview }
  if (isHistoryMutating(command)) return gateHistoryCommand($, command)
  return null
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'guardian-report',
      description: 'Show what guardian has blocked, held or redacted this session',
    })
    return next(e)
  })

  on('tool.call', async (_$, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const scrubbed = redactResult(ran.result)
    const scrubbedText = redactResult(ran.text)
    const text = typeof scrubbedText.result === 'string' ? scrubbedText.result : undefined
    const found = scrubbed.findings.length + scrubbedText.findings.length
    if (found === 0) return ran
    stats.resultsRedacted += found
    mergeKinds(summarize([...scrubbed.findings, ...scrubbedText.findings]))
    return { ...ran, result: scrubbed.result, text }
  })

  // Approval goes through tool.check, so Claude Code shows one permission dialog per call even
  // when other guards ask about the same command; where nobody can answer, an ask is a deny.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const input = e.input as { command?: unknown }
    const command = typeof input.command === 'string' ? input.command : ''
    const verdict = await verdictFor($, command)
    if (verdict === null) return next(e)
    if (verdict.decision === 'deny') stats.commandsBlocked += 1
    else {
      stats.commandsHeld += 1
      if (e.tool_use_id !== undefined) heldCalls.add(e.tool_use_id)
    }
    return verdict
  }).catch(async () => ({ decision: 'deny', reason: 'guardian failed; refusing this call' }))

  on('tool.call', { tool: 'Bash' }, async (_$, e, next) => {
    if (heldCalls.delete(e.tool_use_id)) stats.commandsApproved += 1
    const command: string = typeof e.command === 'string' ? e.command : ''
    const cmdFindings = scan(command)
    if (cmdFindings.length === 0) return next(e)
    mergeKinds(summarize(cmdFindings))
    if (denyReason(cmdFindings)) {
      stats.commandsBlocked += 1
      return { deny: denyReason(cmdFindings) ?? 'guardian: refusing this call' }
    }
    stats.secretsRedacted += cmdFindings.length
    return next({ ...e, command: redact(command, cmdFindings) })
  }).catch(async (_$) => {
    return { deny: 'guardian failed; refusing this call' }
  })

  on('tool.call', { tool: 'Write' }, async (_$, e, next) => {
    const content: string = typeof e.content === 'string' ? e.content : ''
    const findings = scan(content)
    if (findings.length === 0) return next(e)
    if (hasHighSignal(findings)) {
      stats.writesBlocked += 1
      return { deny: denyReason(findings) ?? 'guardian: refusing this write' }
    }
    stats.secretsRedacted += findings.length
    mergeKinds(summarize(findings))
    return next({ ...e, content: redact(content, findings) })
  }).catch(async (_$) => {
    return { deny: 'guardian failed; refusing this write' }
  })

  on('tool.call', { tool: 'Edit' }, async (_$, e, next) => {
    const replacement: string = typeof e.new_string === 'string' ? e.new_string : ''
    const findings = scan(replacement)
    if (findings.length === 0) return next(e)
    if (hasHighSignal(findings)) {
      stats.writesBlocked += 1
      return { deny: denyReason(findings) ?? 'guardian: refusing this edit' }
    }
    stats.secretsRedacted += findings.length
    mergeKinds(summarize(findings))
    return next({ ...e, new_string: redact(replacement, findings) })
  }).catch(async (_$) => {
    return { deny: 'guardian failed; refusing this edit' }
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
