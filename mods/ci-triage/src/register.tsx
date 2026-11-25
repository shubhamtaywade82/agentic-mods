import type { On } from 'claude-code'

import { normalizePath, redact, triageLog, truncate } from '@agentic-mods/core'

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ci',
      description: 'Triage a CI log file: /ci triage <path to the downloaded log>',
    })
    return next(e)
  })

  on('command.run', { command: 'ci' }, async ($, e) => {
    const [subcommand = '', ...rest] = e.args.trim().split(/\s+/)
    if (subcommand !== 'triage' || rest.length === 0) {
      return {
        text: 'Usage: /ci triage <path to the log file>. Download the failed job log first.',
      }
    }
    const path = normalizePath(rest.join(' '))
    const log = await $.fs.read(path)
    const result = triageLog(log)
    const lines = [
      `category: ${result.category}`,
      `evidence: ${redact(result.evidence) || 'none matched'}`,
      `action: ${result.action}`,
      result.stopLoop
        ? 'stop: do not edit code for this failure; fix the environment or credentials first.'
        : 'continue: reproduce the failure locally before changing code.',
    ]
    await $.store.set('lastCategory', result.category)
    return { text: truncate(lines.join('\n'), 2000) }
  })
}
