// Secret handling through guardian's engine hooks: a write that carries a high-signal secret is
// refused before the host writes it, and a secret in a tool result is redacted before it returns.
// The key is AWS's documented example value, not a credential.

import { expect, test } from 'claude-code/testing'

type Stub = Parameters<Parameters<typeof test>[1]>[1]
type Driver = Parameters<Parameters<typeof test>[1]>[0]

const EXAMPLE_KEY = 'AKIAIOSFODNN7EXAMPLE'

/** An empty workspace. Host tool executions are recorded in `hostCalls`; `hostResult` is returned. */
function stubEngine(on: Stub, hostCalls: string[], hostResult: unknown): void {
  const missing = (): never => {
    throw new Error('ENOENT: no such file')
  }
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.read', missing)
  on('fs.stat', missing)
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 0 } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', (_$, e) => {
    hostCalls.push(String((e as { tool?: unknown }).tool ?? ''))
    return { result: hostResult }
  })
}

type Outcome = { denied: boolean; reason: string; result: unknown }

/** A thrown error is not a guard decision: it is reported as not denied, so it cannot pass a test. */
async function callTool(
  $: Driver,
  input: { tool: string; [k: string]: unknown },
): Promise<Outcome> {
  try {
    const result = (await $.tool.call(input)) as { deny?: unknown; result?: unknown }
    if (typeof result.deny === 'string')
      return { denied: true, reason: result.deny, result: undefined }
    return { denied: false, reason: '', result: result.result }
  } catch (err) {
    return {
      denied: false,
      reason: `threw: ${err instanceof Error ? err.message : String(err)}`,
      result: undefined,
    }
  }
}

test('a write that carries an AWS access key is refused before the host writes it', async ($, on) => {
  const hostCalls: string[] = []
  stubEngine(on, hostCalls, 'written')
  const outcome = await callTool($, {
    tool: 'Write',
    file_path: 'config/settings.yml',
    content: `aws_access_key_id: ${EXAMPLE_KEY}\n`,
  })
  expect(outcome.denied).toBe(true)
  expect(outcome.reason).toMatch(/guardian/)
  expect(outcome.reason).not.toContain(EXAMPLE_KEY)
  expect(hostCalls.length).toBe(0)
})

test('a secret in a tool result is redacted before the result is returned', async ($, on) => {
  const hostCalls: string[] = []
  stubEngine(on, hostCalls, `key=${EXAMPLE_KEY}`)
  const outcome = await callTool($, { tool: 'Bash', command: 'ls' })
  expect(outcome.denied).toBe(false)
  expect(hostCalls).toEqual(['Bash'])
  expect(JSON.stringify(outcome.result)).not.toContain(EXAMPLE_KEY)
})

test('an ordinary write with no secret reaches the host unchanged', async ($, on) => {
  const hostCalls: string[] = []
  stubEngine(on, hostCalls, 'written')
  const outcome = await callTool($, {
    tool: 'Write',
    file_path: 'notes.md',
    content: 'plain text, no credentials\n',
  })
  expect(outcome.denied).toBe(false)
  expect(hostCalls).toEqual(['Write'])
})
