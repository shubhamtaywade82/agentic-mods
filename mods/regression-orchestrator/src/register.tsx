import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  assessRegression,
  type GitRunner,
  readJsonFile,
  type RiskResult,
  stateRelativePath,
  workingTreeChanges,
} from '@agentic-mods/core'
import type { GateState } from '../types'

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no regression scope run' }
const gate = atom({ plugin: 'regression-orchestrator', key: 'gate' } as const, IDLE, {
  shape: 'gate-1',
})

function runnerOf($: EngineInterface): GitRunner {
  return async (argv) => {
    const result = await $.process.run(argv)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

/** Check name -> argv from regression.json, or why the file could not be used. */
async function commandsOf(
  $: EngineInterface,
): Promise<{ ok: true; commands: Record<string, string[]> } | { ok: false; error: string }> {
  const file = await readJsonFile((path) => $.fs.read(path), stateRelativePath('regression.json'))
  if (file.kind === 'invalid') return { ok: false, error: file.reason }
  if (file.kind === 'missing' || typeof file.value !== 'object' || file.value === null) {
    return { ok: true, commands: {} }
  }
  const commands = (file.value as { commands?: unknown }).commands
  if (typeof commands !== 'object' || commands === null) return { ok: true, commands: {} }
  const out: Record<string, string[]> = {}
  for (const [name, argv] of Object.entries(commands)) {
    if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === 'string')) {
      out[name] = [...(argv as string[])]
    }
  }
  return { ok: true, commands: out }
}

async function assess($: EngineInterface): Promise<RiskResult | null> {
  const changes = await workingTreeChanges(runnerOf($))
  if (changes === null) return null
  return assessRegression(changes.map((change) => change.path))
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'regression',
      description: 'Regression scope: /regression assess | /regression run',
    })
    return next(e)
  })

  on('command.run', { command: 'regression' }, async ($, e) => {
    const subcommand = e.args.trim() || 'assess'

    if (subcommand === 'assess') {
      const risk = await assess($)
      if (risk === null) return { text: 'Not a git repository; the scope cannot be assessed.' }
      return { text: [...risk.reasons, `required: ${risk.requires.join(', ')}`].join('\n') }
    }

    if (subcommand === 'run') {
      const risk = await assess($)
      if (risk === null) return { text: 'Not a git repository; nothing was run.' }
      const configured = await commandsOf($)
      if (!configured.ok) return { text: configured.error }
      const commands = configured.commands
      const results: string[] = []
      let verdict: GateState['verdict'] = 'PASS'
      for (const name of risk.requires) {
        const argv = commands[name]
        if (argv === undefined) {
          verdict = verdict === 'FAIL' ? 'FAIL' : 'UNKNOWN'
          results.push(`${name}: not configured in .agentic-mods/regression.json`)
          continue
        }
        let result: { exitCode: number; stdout: string; stderr: string }
        try {
          result = await $.process.run(argv, { timeoutMs: 600_000 })
        } catch (error) {
          result = {
            exitCode: -1,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'could not start',
          }
        }
        if (result.exitCode !== 0) verdict = 'FAIL'
        results.push(
          `${name}: ${result.exitCode === 0 ? 'passed' : `failed (exit ${result.exitCode})`}`,
        )
      }
      await update($, gate, () => ({
        verdict,
        phase: 'ran',
        reason: `${risk.level} scope: ${risk.requires.length} check(s)`,
      }))
      return {
        text: [`regression ${risk.level} (score ${risk.score}): ${verdict}`, ...results].join('\n'),
      }
    }

    return { text: 'Usage: /regression assess | /regression run' }
  })
}
