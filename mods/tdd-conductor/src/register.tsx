import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  classifyFailure,
  isTestPath,
  nextPhase,
  productionWriteAllowed,
  stateRelativePath,
  type TddPhase,
  truncate,
  normalizePath,
} from '@agentic-mods/core'
import type { GateState } from '../types'

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'idle', reason: 'no TDD cycle started' }
const gate = atom({ plugin: 'tdd-conductor', key: 'gate' } as const, IDLE, { shape: 'gate-1' })

async function commandOf($: EngineInterface): Promise<string[] | null> {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath('tdd.json'))) as {
      command?: unknown
    }
    if (
      Array.isArray(parsed.command) &&
      parsed.command.length > 0 &&
      parsed.command.every((item) => typeof item === 'string')
    ) {
      return [...(parsed.command as string[])]
    }
  } catch {
    // no configuration: the caller reports it
  }
  return null
}

async function phaseOf($: EngineInterface): Promise<TddPhase> {
  const value = await $.store.get('phase')
  return value === 'red' || value === 'green' || value === 'refactor' || value === 'complete'
    ? value
    : 'idle'
}

async function publish(
  $: EngineInterface,
  phase: TddPhase,
  verdict: GateState['verdict'],
  reason: string,
): Promise<void> {
  await $.store.set('phase', phase)
  await update($, gate, () => ({ verdict, phase, reason: truncate(reason, 200) }))
}

/** Runs the configured test command for one file. Output is returned for classification. */
async function runTests(
  $: EngineInterface,
  testPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string } | string> {
  const command = await commandOf($)
  if (command === null)
    return 'No test command configured. Add {"command": [...]} to .agentic-mods/tdd.json.'
  // A leading dash would reach the test runner as a flag, not a path.
  if (testPath.startsWith('-')) return `Not a test path: ${testPath}`
  try {
    const result = await $.process.run([...command, normalizePath(testPath)], {
      timeoutMs: 600_000,
    })
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return `Could not run the test command: ${error instanceof Error ? error.message : 'unknown error'}`
  }
}

async function guardProduction($: EngineInterface, path: string): Promise<string | null> {
  if (isTestPath(path)) return null
  const phase = await phaseOf($)
  if (productionWriteAllowed(phase)) return null
  if ((await $.store.get('exception')) === true) return null
  return `tdd-conductor: ${path} is production code, and the cycle is ${phase}. Write a failing test first (/tdd red <test>), or record an exception with /tdd exception <reason>.`
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tdd',
      description:
        'TDD cycle: /tdd red|green|refactor|complete <test path>, /tdd exception <reason>, /tdd status',
    })
    return next(e)
  })

  on('command.run', { command: 'tdd' }, async ($, e) => {
    const [subcommand = 'status', ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    const phase = await phaseOf($)

    if (subcommand === 'status') {
      return {
        text: `TDD phase: ${phase}${(await $.store.get('exception')) === true ? ' (exception recorded)' : ''}`,
      }
    }

    if (subcommand === 'exception') {
      const reason = rest.join(' ').trim()
      if (reason === '') return { text: 'Usage: /tdd exception <reason>' }
      await $.store.set('exception', true)
      const logPath = stateRelativePath('tdd-exceptions.log')
      const earlier = await $.fs.read(logPath).catch(() => '')
      await $.fs.write(
        logPath,
        `${earlier}${new Date(await $.clock.now()).toISOString()} ${truncate(reason, 300)}\n`,
      )
      return { text: 'Exception recorded: production edits are allowed until the next RED.' }
    }

    const testPath = rest.join(' ')

    if (subcommand === 'red') {
      if (testPath === '') return { text: 'Usage: /tdd red <test path>' }
      const run = await runTests($, testPath)
      if (typeof run === 'string') return { text: run }
      await $.store.set('exception', false)
      const kind = classifyFailure(run.stdout, run.stderr)
      if (run.exitCode === 0) {
        await publish($, phase, 'UNKNOWN', 'the test passed: RED needs a failing test')
        return {
          text: 'RED rejected: the test passed. Write a test that fails for the missing behavior.',
        }
      }
      if (kind !== 'behavioral') {
        await publish($, phase, 'UNKNOWN', `RED rejected: the failure is ${kind}, not behavioral`)
        return {
          text: `RED rejected: the failure is ${kind}. Fix the environment or compile error first.`,
        }
      }
      const transition = nextPhase(phase, 'red-verified')
      if (!transition.ok) return { text: transition.reason }
      await publish($, transition.phase, 'PASS', `RED verified: ${testPath}`)
      return {
        text: `RED verified: ${testPath} fails for a behavioral reason. Implement the minimum to pass it.`,
      }
    }

    if (subcommand === 'green') {
      if (testPath === '') return { text: 'Usage: /tdd green <test path>' }
      const transition = nextPhase(phase, 'green-verified')
      if (!transition.ok) return { text: transition.reason }
      const run = await runTests($, testPath)
      if (typeof run === 'string') return { text: run }
      if (run.exitCode !== 0) {
        await publish($, phase, 'FAIL', `GREEN not reached: ${testPath} still fails`)
        return { text: `GREEN not reached: ${testPath} still fails.` }
      }
      const label = transition.phase === 'refactor' ? 'REFACTOR verified' : 'GREEN verified'
      await publish($, transition.phase, 'PASS', `${label}: ${testPath}`)
      return { text: `${label}: ${testPath} passes.` }
    }

    if (subcommand === 'refactor') {
      const transition = nextPhase(phase, 'refactor')
      if (!transition.ok) return { text: transition.reason }
      await publish(
        $,
        transition.phase,
        'UNKNOWN',
        'REFACTOR started: run /tdd green <test> to confirm it stays green',
      )
      return {
        text: 'REFACTOR started. Keep behavior unchanged; confirm with /tdd green <test path>.',
      }
    }

    if (subcommand === 'complete') {
      const transition = nextPhase(phase, 'complete')
      if (!transition.ok) return { text: transition.reason }
      await publish($, transition.phase, 'PASS', 'cycle complete')
      return { text: 'Cycle complete.' }
    }

    return {
      text: 'Usage: /tdd red|green|refactor|complete <test path> | /tdd exception <reason> | /tdd status',
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const denial = await guardProduction($, e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'tdd-conductor failed closed on Edit.' },
  )

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const denial = await guardProduction($, e.file_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'tdd-conductor failed closed on Write.' },
  )

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const denial = await guardProduction($, e.notebook_path)
    return denial === null ? next(e) : { deny: denial }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'tdd-conductor failed closed on NotebookEdit.' },
  )
}
