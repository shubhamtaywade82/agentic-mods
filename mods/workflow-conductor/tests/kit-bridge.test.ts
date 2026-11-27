// /workflow for kit-backed workflows: the Agentic SDLC Kit owns the run. These tests check the argv the
// mod launches (exact, never a string from the kit), the plan check before any phase that executes
// verification, and the refusals when the kit is missing, blocked or answers with something unexpected.

import { expect, test } from 'claude-code/testing'

type Stub = Parameters<Parameters<typeof test>[1]>[1]
type Driver = Parameters<Parameters<typeof test>[1]>[0]

const RED_PAYLOAD = {
  schemaVersion: 1,
  featureId: 'FEAT-1',
  status: 'in_progress',
  taskId: 'TASK-1',
  phase: 'red',
  requiredAction: 'task.red',
  verificationCommand: ['node', 'check.js'],
  nextInvocation: 'kit feature FEAT-1 red TASK-1',
  blockingQuestions: [],
  advisoryLessons: [],
  constraints: { timeoutMs: 60000, maxOutputBytes: 10485760 },
}

const SAFE_PLAN = JSON.stringify({
  tasks: [{ id: 'TASK-1', verification: { command: ['node', 'check.js'] } }],
})
const HOSTILE_PLAN = JSON.stringify({
  tasks: [{ id: 'TASK-1', verification: { command: ['rm', '-rf', 'dist'] } }],
})

type Kit = {
  available: boolean
  /** What `kit next FEAT-1 --json` answers now: a payload, or a blocked/error exit. */
  next: { exitCode: number; stdout: string; stderr: string }
  files: Record<string, string>
  launches: string[][]
}

function kitAnswering(next: Kit['next'], files: Record<string, string>): Kit {
  return { available: true, next, files, launches: [] }
}

function workflowInput(args: string) {
  return {
    command: 'workflow',
    args,
    origin: { kind: 'plugin', name: 'workflow-conductor' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const
}

/** Every process launch and file read is recorded on `kit`. The kit answers as configured. */
function stubEngine(on: Stub, kit: Kit): void {
  const values = new Map<string, unknown>()
  const missing = (): never => {
    throw new Error('ENOENT: no such file')
  }
  on('store.get', (_$, e) => ({ value: values.get(String((e as { key?: unknown }).key)) }))
  on('store.set', (_$, e) => {
    const { key, value } = e as { key?: unknown; value?: unknown }
    values.set(String(key), value)
    return { value: undefined }
  })
  on('store.delete', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.read', (_$, e) => {
    // The engine may pass the path as given or resolved, so a file is matched by its suffix.
    const path = String((e as { path?: unknown }).path ?? '')
    const key = Object.keys(kit.files).find((name) => path.endsWith(name))
    return key === undefined ? missing() : { value: kit.files[key] }
  })
  on('fs.stat', missing)
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const argv = [...((e as { argv?: string[] }).argv ?? [])]
    kit.launches.push(argv)
    const key = argv.join(' ')
    if (key === 'kit --version') {
      return kit.available
        ? { value: { stdout: '0.9.1\n', stderr: '', exitCode: 0 } }
        : { value: { stdout: '', stderr: 'kit: not found', exitCode: 127 } }
    }
    if (key === 'kit next FEAT-1 --json') return { value: kit.next }
    if (argv[0] === 'kit' && argv[3] === 'start') {
      return { value: { stdout: `TDD run started for ${argv[2]}.`, stderr: '', exitCode: 0 } }
    }
    if (argv[0] === 'kit' && ['red', 'green', 'refactor', 'verify'].includes(argv[3] ?? '')) {
      return { value: { stdout: 'recorded', stderr: '', exitCode: 0 } }
    }
    return { value: { stdout: '', stderr: `unexpected launch: ${key}`, exitCode: 1 } }
  })
}

async function workflow($: Driver, args: string): Promise<string> {
  return (await $.command.run(workflowInput(args))).text
}

const ready = (): Kit['next'] => ({ exitCode: 0, stdout: JSON.stringify(RED_PAYLOAD), stderr: '' })

test('start feature-development launches the kit start with exact argv and shows the next action', async ($, on) => {
  const kit = kitAnswering(ready(), { 'docs/plans/FEAT-1/plan.json': SAFE_PLAN })
  stubEngine(on, kit)
  const text = await workflow($, 'start feature-development FEAT-1')
  expect(kit.launches).toContainEqual(['kit', 'feature', 'FEAT-1', 'start'])
  expect(text).toContain('feature run FEAT-1 (in_progress): TASK-1 red')
  expect(text).toContain('Next: kit feature FEAT-1 red TASK-1')
})

test('bug-fix starts the kit fix command family', async ($, on) => {
  const kit = kitAnswering(ready(), {})
  stubEngine(on, kit)
  await workflow($, 'start bug-fix FEAT-1')
  expect(kit.launches).toContainEqual(['kit', 'fix', 'FEAT-1', 'start'])
})

test('a missing kit refuses the start, with the install command, and launches nothing else', async ($, on) => {
  const kit: Kit = { ...kitAnswering(ready(), {}), available: false }
  stubEngine(on, kit)
  const text = await workflow($, 'start feature-development FEAT-1')
  expect(text).toContain('npm install -g @agentic-sdlc-kit/cli')
  expect(kit.launches).toEqual([['kit', '--version']])
})

test('advance runs the phase the kit names, built from its structured fields', async ($, on) => {
  const kit = kitAnswering(ready(), { 'docs/plans/FEAT-1/plan.json': SAFE_PLAN })
  stubEngine(on, kit)
  await workflow($, 'start feature-development FEAT-1')
  const text = await workflow($, 'advance')
  expect(kit.launches).toContainEqual(['kit', 'feature', 'FEAT-1', 'red', 'TASK-1'])
  expect(text).toContain('kit feature FEAT-1 red TASK-1 -> exit 0')
})

test('advance is refused when the plan hides a destructive verification command', async ($, on) => {
  const kit = kitAnswering(ready(), { 'docs/plans/FEAT-1/plan.json': HOSTILE_PLAN })
  stubEngine(on, kit)
  await workflow($, 'start feature-development FEAT-1')
  const text = await workflow($, 'advance')
  expect(text).toContain('verification commands are not allowed')
  expect(text).toContain('TASK-1')
  expect(kit.launches.some((argv) => argv[3] === 'red')).toBe(false)
})

test('advance is refused when the plan cannot be read, so its commands cannot be checked', async ($, on) => {
  const kit = kitAnswering(ready(), {})
  stubEngine(on, kit)
  await workflow($, 'start feature-development FEAT-1')
  const text = await workflow($, 'advance')
  expect(text).toContain('cannot be read')
  expect(kit.launches.some((argv) => argv[3] === 'red')).toBe(false)
})

test('status shows the kit blocked answer as text, not as a crash', async ($, on) => {
  const kit = kitAnswering(ready(), { 'docs/plans/FEAT-1/plan.json': SAFE_PLAN })
  stubEngine(on, kit)
  await workflow($, 'start feature-development FEAT-1')
  kit.next = { exitCode: 3, stdout: '', stderr: 'kit next: no active feature runs' }
  expect(await workflow($, 'status')).toContain('no active feature runs')
})

test('defer and cancel are refused for a kit run, because the kit owns its state', async ($, on) => {
  const kit = kitAnswering(ready(), { 'docs/plans/FEAT-1/plan.json': SAFE_PLAN })
  stubEngine(on, kit)
  await workflow($, 'start feature-development FEAT-1')
  expect(await workflow($, 'defer specification-gate some reason')).toContain('no deferrals')
  expect(await workflow($, 'cancel')).toContain('cannot be cancelled')
})

test('a second kit run cannot start while the first is active', async ($, on) => {
  const kit = kitAnswering(ready(), { 'docs/plans/FEAT-1/plan.json': SAFE_PLAN })
  stubEngine(on, kit)
  await workflow($, 'start feature-development FEAT-1')
  expect(await workflow($, 'start bug-fix FEAT-2')).toContain('is active')
  expect(kit.launches.some((argv) => argv[2] === 'FEAT-2')).toBe(false)
})

test('a workflow id that only names an Object.prototype member is not a kit workflow', async ($, on) => {
  const kit = kitAnswering(ready(), {})
  stubEngine(on, kit)
  expect(await workflow($, 'start constructor FEAT-1')).toContain('Unknown workflow')
  expect(kit.launches.length).toBe(0)
})

test('a run id that is not a plain identifier is refused before any launch', async ($, on) => {
  const kit = kitAnswering(ready(), {})
  stubEngine(on, kit)
  const text = await workflow($, 'start feature-development FEAT;1')
  expect(text).toContain('not a valid id')
  expect(kit.launches.some((argv) => argv[0] === 'kit' && argv[1] === 'feature')).toBe(false)
})
