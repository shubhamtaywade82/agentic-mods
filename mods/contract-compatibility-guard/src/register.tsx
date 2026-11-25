import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { redact, stateRelativePath, truncate, registerCommand } from '@agentic-mods/core'
import type { GateState } from '../types'

const CONTRACT_FILE =
  /(openapi|swagger)[^/]*\.(ya?ml|json)$|\.proto$|schema\.graphql$|asyncapi[^/]*\.(ya?ml|json)$/i
const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no compatibility check run' }
const gate = atom({ plugin: 'contract-compatibility-guard', key: 'gate' } as const, IDLE, {
  shape: 'gate-1',
})

async function commandsOf($: EngineInterface): Promise<Record<string, string[]>> {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath('compat.json'))) as Record<
      string,
      unknown
    >
    const out: Record<string, string[]> = {}
    for (const [name, argv] of Object.entries(parsed)) {
      if (
        Array.isArray(argv) &&
        argv.length > 0 &&
        argv.every((item) => typeof item === 'string')
      ) {
        out[name] = [...(argv as string[])]
      }
    }
    return out
  } catch {
    return {}
  }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerCommand($, {
      name: 'compat',
      description:
        'Compatibility checks: /compat run [name] (tools from .agentic-mods/compat.json)',
    })
    return next(e)
  })

  on('command.run', { command: 'compat' }, async ($, e) => {
    const [subcommand = 'run', only = ''] = e.args.trim().split(/\s+/)
    if (subcommand !== 'run') return { text: 'Usage: /compat run [name]' }
    const commands = await commandsOf($)
    const names = only === '' ? Object.keys(commands) : [only]
    if (names.length === 0 || names.some((name) => commands[name] === undefined)) {
      return {
        text: 'No compatibility tool configured. Add {"name": ["argv", ...]} to .agentic-mods/compat.json.',
      }
    }
    const lines: string[] = []
    let verdict: GateState['verdict'] = 'PASS'
    for (const name of names) {
      const argv = commands[name] ?? []
      let result: { exitCode: number; stdout: string; stderr: string }
      try {
        result = await $.process.run(argv, { timeoutMs: 300_000 })
      } catch (error) {
        result = {
          exitCode: -1,
          stdout: '',
          stderr: error instanceof Error ? error.message : 'could not start',
        }
      }
      if (result.exitCode !== 0) verdict = 'FAIL'
      const tail = redact(`${result.stdout}\n${result.stderr}`).split('\n').slice(-6).join('\n')
      lines.push(
        `${name}: ${result.exitCode === 0 ? 'compatible' : `incompatible or error (exit ${result.exitCode})`}`,
      )
      if (result.exitCode !== 0) lines.push(truncate(tail, 800))
    }
    await update($, gate, () => ({
      verdict,
      phase: 'checked',
      reason: truncate(`${names.length} tool(s) run: ${names.join(', ')}`, 200),
    }))
    return { text: lines.join('\n') }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (CONTRACT_FILE.test(e.file_path)) {
      $.ui.toast(
        'contract-compatibility-guard: a schema changed. Run /compat run before the review gate.',
      )
    }
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (CONTRACT_FILE.test(e.file_path)) {
      $.ui.toast(
        'contract-compatibility-guard: a schema changed. Run /compat run before the review gate.',
      )
    }
    return next(e)
  })
}
