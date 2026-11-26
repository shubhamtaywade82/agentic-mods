// Declared-check selection and execution for the verify mod.
//
// A verification run executes only the commands an operator declared under `evidence.commands` in
// .agentic-mods/config.json. Text typed by a person or produced by a model is never split into argv,
// so it cannot reach the process API. Each declared argv is still judged by the process policy, which
// refuses a destructive command even when it was declared.
//
// Execution is injected, so this module is pure and testable without an engine session.

import { isCheckName, CHECKS, type CheckName } from './classify'
import { decideProcess } from './command-policy'
import type { AgenticConfig } from './config'

export type ExecResult = { readonly exitCode: number; readonly output: string }
export type Exec = (argv: readonly string[]) => Promise<ExecResult>

export type CheckSelection =
  | {
      readonly ok: true
      readonly name: CheckName
      readonly commands: readonly (readonly string[])[]
    }
  | { readonly ok: false; readonly reason: string }

export type CheckStep = {
  readonly argv: readonly string[]
  readonly exitCode: number
  /** The last 200 characters of combined output, enough to show why a step failed. */
  readonly tail: string
}

export type CheckRun = {
  readonly name: CheckName
  readonly passed: boolean
  readonly steps: readonly CheckStep[]
  /** Commands declared for the check. Fewer steps than this means the run stopped early. */
  readonly declared: number
}

/** The checks that can run: declared, and not refused by the process policy. Canonical order. */
export function configuredChecks(config: AgenticConfig): CheckName[] {
  return CHECKS.filter((name) => selectCheck(config, name).ok)
}

/**
 * Resolves the requested check against the declared commands. Refuses an unknown name, a check with
 * nothing declared, and any declared argv that the process policy denies.
 */
export function selectCheck(config: AgenticConfig, requested: string): CheckSelection {
  const name = requested.trim()
  if (!isCheckName(name)) {
    return { ok: false, reason: `unknown check "${name}". Checks: ${CHECKS.join(', ')}` }
  }
  const commands = config.evidence.commands[name] ?? []
  if (commands.length === 0) {
    return {
      ok: false,
      reason: `no command is declared for ${name}. Add one under evidence.commands in .agentic-mods/config.json.`,
    }
  }
  for (const argv of commands) {
    const decision = decideProcess(argv)
    if (decision.kind !== 'allow') {
      return { ok: false, reason: `${name}: declared command refused. ${decision.reason}` }
    }
  }
  return { ok: true, name, commands }
}

/**
 * Runs the declared commands of a selected check in order and stops at the first non-zero exit. A
 * check passes only when every declared command ran and exited 0. Nothing is retried: a verification
 * that fails is reported, not re-executed.
 */
export async function runSelectedCheck(
  selection: Extract<CheckSelection, { ok: true }>,
  exec: Exec,
): Promise<CheckRun> {
  const steps: CheckStep[] = []
  for (const argv of selection.commands) {
    let result: ExecResult
    try {
      result = await exec(argv)
    } catch (err) {
      // A launch that throws is a failed step, never a skipped or passing one.
      const message = err instanceof Error ? err.message : String(err)
      result = { exitCode: 1, output: `launch failed: ${message}` }
    }
    steps.push({ argv, exitCode: result.exitCode, tail: result.output.trim().slice(-200) })
    if (result.exitCode !== 0) break
  }
  const passed =
    steps.length === selection.commands.length && steps.every((step) => step.exitCode === 0)
  return { name: selection.name, passed, steps, declared: selection.commands.length }
}

export function renderCheckRun(run: CheckRun): string {
  const lines = [`verify ${run.name}: ${run.passed ? 'PASS' : 'FAIL'}`]
  for (const step of run.steps) {
    const mark = step.exitCode === 0 ? '✓' : '✗'
    lines.push(`  ${mark} ${step.argv.join(' ')}  (exit ${step.exitCode})`)
  }
  const notRun = run.declared - run.steps.length
  if (notRun > 0) lines.push(`  ${notRun} declared command(s) not run after the failure`)
  const failed = run.steps.find((step) => step.exitCode !== 0)
  if (failed !== undefined && failed.tail !== '') lines.push(`  output: ${failed.tail}`)
  return lines.join('\n')
}

/** Session summary for /verify-status. */
export function renderCheckRuns(runs: readonly CheckRun[]): string {
  if (runs.length === 0) return 'verify: no runs this session.'
  const passed = runs.filter((run) => run.passed).length
  return [
    'verify session status:',
    `  runs: ${runs.length} (passed ${passed}, failed ${runs.length - passed})`,
    ...runs.map((run) => `  ${run.passed ? '✓' : '✗'} ${run.name}`),
  ].join('\n')
}
