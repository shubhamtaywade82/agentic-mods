// The kit-backed workflows: the Agentic SDLC Kit owns the run, its phases and its evidence. This module
// only asks the kit what is next, and runs the phase command the kit names. It keeps no run state of
// its own beyond a pointer to the feature id.

import {
  deniedPlanCommands,
  executesVerification,
  KIT_BACKED_WORKFLOWS,
  KIT_ID_PATTERN,
  kitPhaseArgv,
  parseKitNextAction,
  parseKitVersion,
  type KitMode,
  type KitNextAction,
} from '@agentic-mods/core'

export type LaunchResult = { exitCode: number; stdout: string; stderr: string }
/** Runs argv with no shell, through the engine's process hook. Must not throw for a launch failure. */
export type Launch = (argv: readonly string[]) => Promise<LaunchResult>
/** Reads a repository file. Rejects when the file does not exist. */
export type ReadFile = (path: string) => Promise<string>

/** The only state this mod keeps for a kit run: which workflow it is, and the kit's run id. */
export type StoredKitRun = { workflow: string; featureId: string }

/** The kit command family for a workflow id, or undefined. Own keys only: `constructor` is not a mode. */
export function kitModeOf(workflow: string): KitMode | undefined {
  return Object.hasOwn(KIT_BACKED_WORKFLOWS, workflow) ? KIT_BACKED_WORKFLOWS[workflow] : undefined
}

export const KIT_INSTALL_HINT =
  'the Agentic SDLC Kit is not installed or not on PATH. Install it with `npm install -g @agentic-sdlc-kit/cli`, then try again.'

const TAIL_CHARS = 600

function tail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > TAIL_CHARS ? `…${trimmed.slice(-TAIL_CHARS)}` : trimmed
}

/** A launch that throws is reported as a failed launch, never as success. */
async function safeLaunch(launch: Launch, argv: readonly string[]): Promise<LaunchResult> {
  try {
    return await launch(argv)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, stdout: '', stderr: `launch failed: ${message}` }
  }
}

/** True only when `kit --version` runs and prints a version. */
export async function kitAvailable(launch: Launch): Promise<boolean> {
  const result = await safeLaunch(launch, ['kit', '--version'])
  return result.exitCode === 0 && parseKitVersion(result.stdout) !== null
}

export type KitState = { ok: true; action: KitNextAction } | { ok: false; message: string }

/** Asks the kit what is next for a run. Exit 3 is the kit's own "blocked" answer, shown as text. */
export async function kitNext(launch: Launch, featureId: string): Promise<KitState> {
  if (!KIT_ID_PATTERN.test(featureId))
    return { ok: false, message: `not a valid run id: ${featureId}` }
  const result = await safeLaunch(launch, ['kit', 'next', featureId, '--json'])
  if (result.exitCode === 3) return { ok: false, message: tail(result.stderr) || 'kit is blocked' }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: `kit next failed (exit ${result.exitCode}): ${tail(result.stderr || result.stdout)}`,
    }
  }
  const parsed = parseKitNextAction(result.stdout)
  if (!parsed.ok) return { ok: false, message: `kit output refused: ${parsed.error}` }
  return { ok: true, action: parsed.value }
}

/**
 * Checks the plan's verification commands before the kit runs them. The kit executes them itself, outside
 * the engine's process hook, so this is the only place a denied command is caught. Returns the refusal, or
 * null when every command is allowed.
 */
export async function planRefusal(readFile: ReadFile, featureId: string): Promise<string | null> {
  let text: string
  try {
    text = await readFile(`docs/plans/${featureId}/plan.json`)
  } catch {
    return `workflow-conductor refused: docs/plans/${featureId}/plan.json cannot be read, so its verification commands cannot be checked. Plans written as PLAN.md alone are not checked yet.`
  }
  const checked = deniedPlanCommands(text)
  if (!checked.ok) return `workflow-conductor refused: ${checked.error}.`
  if (checked.value.length > 0) {
    return `workflow-conductor refused: the plan's verification commands are not allowed:\n${checked.value.map((line) => `  ${line}`).join('\n')}`
  }
  return null
}

/** Starts a kit run. Returns the text to show and the pointer to store, if the run started. */
export async function startKitRun(
  launch: Launch,
  workflow: string,
  featureId: string,
): Promise<{ text: string; started: StoredKitRun | null }> {
  const mode = kitModeOf(workflow)
  if (mode === undefined)
    return { text: `${workflow} is not a kit-backed workflow.`, started: null }
  if (!KIT_ID_PATTERN.test(featureId)) {
    return {
      text: `Usage: /workflow start <workflow> <id>. ${featureId} is not a valid id.`,
      started: null,
    }
  }
  const result = await safeLaunch(launch, ['kit', mode, featureId, 'start'])
  if (result.exitCode !== 0) {
    return {
      text: `kit ${mode} start failed (exit ${result.exitCode}): ${tail(result.stderr || result.stdout)}`,
      started: null,
    }
  }
  return {
    text: tail(result.stdout) || `Started ${mode} run ${featureId}.`,
    started: { workflow, featureId },
  }
}

export type PhaseOutcome = { ok: boolean; text: string }

/**
 * Runs the phase the kit is waiting for. The argv comes from the kit's structured answer, never from its
 * human-readable next command. A phase that executes verification is refused unless the plan's commands
 * pass the process policy.
 */
export async function runKitPhase(
  launch: Launch,
  readFile: ReadFile,
  mode: KitMode,
  action: KitNextAction,
): Promise<PhaseOutcome> {
  const argv = kitPhaseArgv(mode, action.featureId, action)
  if (argv === null) return { ok: false, text: `${action.requiredAction} has no command to run.` }
  if (executesVerification(action)) {
    const refusal = await planRefusal(readFile, action.featureId)
    if (refusal !== null) return { ok: false, text: refusal }
  }
  const result = await safeLaunch(launch, argv)
  const header = `${argv.join(' ')} -> exit ${result.exitCode}`
  const body = tail(result.stdout || result.stderr)
  return { ok: result.exitCode === 0, text: body === '' ? header : `${header}\n${body}` }
}
