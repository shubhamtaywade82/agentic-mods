// guardian: tool governance mod.
//
// Three pure libs hold the logic:
//   - lib/secrets.ts : secret patterns, redaction, summarize, redactResult
//   - lib/blast.ts   : destructive-command tripwires
//   - lib/gate.ts    : approval tier + git-diff inspection
//
// Five enforcement points, all fail-closed:
//   1. tool.call Bash        -> destructive? hold for approval (else deny)
//   2. tool.call Bash        -> secret in command line? high-signal deny / maybe redact
//   3. tool.call Bash        -> git commit/push? gate the staged diff for secrets
//   4. tool.call Write/Edit  -> secret in content? high-signal deny / maybe redact
//   5. tool.result (all)     -> redact secrets the tool returned before the model sees them
//
// The approval tier is the third behavior beyond block-or-pass: a held
// operation shows its impact preview and proceeds only on explicit approval.
// Non-interactive sessions (no $.approval, or it times out) deny the op.

import type { HostApi, Register } from 'claude-code'
import { checkCommand, denyMessage } from './lib/blast'
import {
  denyReason,
  hasHighSignal,
  redact,
  redactResult,
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

/** Ask the host for approval, fail-closed on any error or missing capability. */
async function requestApproval(
  $: HostApi,
  command: string,
  reason: string,
  preview: string,
): Promise<'approve' | 'deny'> {
  try {
    const decision = await $.approval.ask({ command, reason, preview })
    if (decision === 'approve') return 'approve'
    return 'deny'
  } catch {
    // Host has no approval capability, or it threw: deny (fail closed).
    return 'deny'
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guardian-report',
      description: 'Show what guardian has blocked, held or redacted this session',
    })
    return next(e)
  })

  // GUARD (fail closed): inspect Bash commands before they run.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command: string = e.command ?? ''

    // 1. Destructive-command tripwire -> hold for approval (else deny).
    const blast = checkCommand(command)
    if (blast) {
      stats.commandsHeld += 1
      const held = holdForBlast(command, blast)
      const decision = await requestApproval($, held.command, 'destructive-command', held.preview)
      if (decision === 'approve') {
        stats.commandsApproved += 1
        return next(e) // the caller already showed the command; we let it run
      }
      stats.commandsBlocked += 1
      return { deny: denyMessage(blast) }
    }

    // 2. Secret in the command line itself.
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

    // 3. git commit/push: gate the staged diff for secrets.
    if (isHistoryMutating(command)) {
      const gate = await gateHistoryCommand($, command)
      if (gate) return gate // a deny decision
    }

    return next(e)
  }).catch(async (_$, _e, next) => {
    void _$
    void _e
    return next.called ? next(undefined) : { deny: 'guardian failed; refusing this call' }
  })

  // GUARD (fail closed): inspect Write/Edit content before it lands in files.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const content: string = e.content ?? ''
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
  }).catch(async (_$, _e, next) => {
    void _$
    void _e
    return next.called ? next(undefined) : { deny: 'guardian failed; refusing this write' }
  })

  // OBSERVE + REWRITE: redact secrets the tool returned before the model sees them.
  // This is the data-protection point Secret Guard adds over a call-only gate.
  on('tool.result', async (_$, e, next) => {
    void _$
    const { result, findings } = redactResult(e.result)
    if (findings.length > 0) {
      stats.resultsRedacted += findings.length
      mergeKinds(summarize(findings))
      return next({ ...e, result })
    }
    return next(e)
  }).catch(async (_$, e, next) => {
    void _$
    // A redaction failure must NOT block the tool result from reaching the
    // model — return the original event so the conversation continues.
    return next(e)
  })

  // ANSWER: report this session's activity.
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

/**
 * Gate a history-mutating git command (commit/push/tag) by inspecting the
 * staged diff. Returns a { deny } when the diff contains a secret or could
 * not be scanned; returns null to let the command proceed.
 */
async function gateHistoryCommand(
  $: HostApi,
  command: string,
): Promise<{ deny: string } | null> {
  // Compute the diff the command would commit/push. We ask the host to run a
  // read-only `git diff` so we never execute the mutating command ourselves.
  let diffText = ''
  try {
    const res = (await $.tool.call({ tool: 'Bash', command: 'git diff --cached' })) as {
      stdout?: string
      result?: string
      text?: string
    } | string
    diffText =
      typeof res === 'string' ? res : (res?.stdout ?? res?.result ?? res?.text ?? '')
  } catch {
    // Diff unavailable: we cannot verify, so fail closed.
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

  // Secret found in the diff. High-signal ones always deny; maybes hold.
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

  // Maybe-secrets: hold for approval, deny if unanswered.
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
