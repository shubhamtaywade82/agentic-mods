import type { On } from 'claude-code'
import {
  configuredChecks,
  loadConfig,
  registerCommand,
  renderCheckRun,
  renderCheckRuns,
  runSelectedCheck,
  selectCheck,
  type CheckRun,
} from '@agentic-mods/core'

// Verification results for this session. Reset when the session starts.
const runs: CheckRun[] = []

function strField(e: unknown, key: string): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'verify-run',
      description:
        'Run a check declared under evidence.commands and pass only when every command exits 0: /verify-run <check>',
    })
    await registerCommand($, {
      name: 'verify-status',
      description: 'Show the outcomes of every verify-run this session',
    })
    runs.length = 0
    return next(e)
  })

  on('command.run', { command: 'verify-run' }, async ($, e) => {
    // Only operator-declared commands run. The text after the command is a check name, never argv,
    // so nothing typed or generated in the session reaches the process API.
    const config = (await loadConfig((path) => $.fs.read(path))).value
    const requested = strField(e, 'args') ?? ''
    if (requested.trim() === '') {
      const names = configuredChecks(config)
      return {
        text:
          names.length === 0
            ? 'usage: /verify-run <check>. No check can run: declare commands under evidence.commands in .agentic-mods/config.json.'
            : `usage: /verify-run <check>. Declared checks: ${names.join(', ')}`,
      }
    }

    const selection = selectCheck(config, requested)
    if (!selection.ok) return { text: `verify: ${selection.reason}` }

    // Each declared command runs once, through the engine's process API, so mod-firewall and the
    // process policy see it. A failure is reported; it is never retried.
    const run = await runSelectedCheck(selection, async (argv) => {
      const res = await $.process.run([...argv])
      return { exitCode: res.exitCode ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` }
    })
    runs.push(run)
    return { text: renderCheckRun(run) }
  })

  on('command.run', { command: 'verify-status' }, async () => {
    return { text: renderCheckRuns(runs) }
  })
}
