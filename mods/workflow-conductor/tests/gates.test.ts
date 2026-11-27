// Gate behaviour through /workflow: a stage with a gate cannot advance until its facts pass, a stage
// without a gate advances freely, and an unknown workflow or stage is refused. The run state is kept
// in an in-memory store, so each command sees what the previous one saved.

import { expect, test } from 'claude-code/testing'

type Stub = Parameters<Parameters<typeof test>[1]>[1]
type Driver = Parameters<Parameters<typeof test>[1]>[0]

function workflowInput(args: string) {
  return {
    command: 'workflow',
    args,
    origin: { kind: 'plugin', name: 'workflow-conductor' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const
}

/** An empty workspace with a persistent in-memory store. Facts come from no other mod. */
function stubEngine(on: Stub): void {
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
  on('store.delete', (_$, e) => {
    values.delete(String((e as { key?: unknown }).key))
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.read', missing)
  on('fs.stat', missing)
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0 } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

async function workflow($: Driver, args: string): Promise<string> {
  const answer = await $.command.run(workflowInput(args))
  return answer.text
}

test('a stage without a gate advances, and the next stage is the one shown', async ($, on) => {
  stubEngine(on)
  // The status text marks the current stage with "> ".
  expect(await workflow($, 'start feature-development T-1')).toContain('> Discover')
  const advanced = await workflow($, 'advance')
  expect(advanced).toContain('> Specify')
  expect(advanced).not.toContain('> Discover')
})

test('a stage with an unmet gate cannot advance and names the missing evidence', async ($, on) => {
  stubEngine(on)
  await workflow($, 'start feature-development T-1')
  await workflow($, 'advance') // discover has no gate: now at specify, which has one
  const refused = await workflow($, 'advance')
  expect(refused).toContain('specify gate is not satisfied')
  expect(refused).toContain('missing evidence: specification')
})

test('the blocker list keeps the unmet gate visible after a refused advance', async ($, on) => {
  stubEngine(on)
  await workflow($, 'start feature-development T-1')
  await workflow($, 'advance')
  await workflow($, 'advance')
  const status = await workflow($, 'status')
  expect(status).toContain('specification-gate: specification')
})

test('a stage cannot jump to a target it does not declare', async ($, on) => {
  stubEngine(on)
  await workflow($, 'start feature-development T-1')
  const refused = await workflow($, 'advance release')
  expect(refused).toContain('discover cannot move to release')
})

test('an unknown workflow is refused and nothing starts', async ($, on) => {
  stubEngine(on)
  const answer = await workflow($, 'start made-up-flow T-9')
  expect(answer).toContain('Unknown workflow')
  expect(await workflow($, 'status')).toContain('No workflow is running')
})
