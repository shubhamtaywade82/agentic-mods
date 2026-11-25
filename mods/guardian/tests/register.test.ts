import { expect, test } from 'claude-code/testing'

// Session-level tests: the guards actually intercept tool calls.
//
// Note: the deny assertions run against `res`, which the test runtime gives
// us when a hook denies the call. We assert only what OUR hook returns.

const reportInput = {
  command: 'guardian-report',
  args: '',
  origin: { kind: 'plugin', name: 'guardian' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('a destructive Bash command is denied and never runs', async ($, on) => {
  let ran = false
  // The approval prompt is itself a tool call, so only count the Bash call.
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({ tool: 'Bash', command: 'rm -rf /tmp/whatever' })
    .catch((r: unknown) => r)) as { deny?: string; isError?: boolean }
  // With nobody to answer the permission dialog, guardian's ask is a deny.
  expect(res.isError === true || typeof res.deny === 'string').toBe(true)
  expect(ran).toBe(false)
})

test('a destructive command is put to one permission dialog with the impact as its reason', async ($) => {
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  expect(verdict.decision).toBe('ask')
  expect(verdict.reason ?? '').toContain('rm-rf')
})

test('an ordinary Bash command runs unchanged', async ($, on) => {
  let seen: unknown = null
  on('tool.call', (_$, e) => {
    seen = (e as Record<string, unknown>).command
    return { result: 'ok' }
  })

  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(seen).toBe('ls -la')
})

test('a Bash command carrying a real secret is denied', async ($, on) => {
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({
      tool: 'Bash',
      command:
        'curl -H "Authorization: Bearer ghp_16C7e42F292c6912E7710c838347Ae178B4a" https://api.example.com',
    })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('github-pat')).toBe(true)
  expect(ran).toBe(false)
})

test('a Write embedding a private key is denied', async ($, on) => {
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({
      tool: 'Write',
      file_path: 'key.txt',
      content: '-----BEGIN RSA PRIVATE KEY-----\nabc\n',
    })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('private-key')).toBe(true)
  expect(ran).toBe(false)
})

test('/guardian-report reflects what happened this session', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool
    .call({ tool: 'Bash', command: 'git push --force origin main' })
    .catch(() => undefined)
  const answer = await $.command.run(reportInput)
  expect(answer.text).toContain('guardian session report')
  expect(answer.text).toContain('blocked')
})

test('an Edit that inserts a private key is denied', async ($, on) => {
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({
      tool: 'Edit',
      file_path: 'key.txt',
      old_string: 'x',
      new_string: '-----BEGIN RSA PRIVATE KEY-----\nabc\n',
    })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('private-key')).toBe(true)
  expect(ran).toBe(false)
})

test('a secret in a tool result is redacted before the model sees it', async ($, on) => {
  on('tool.call', () => ({ result: 'token AKIAIOSFODNN7EXAMPLE here', isError: false }))

  const res = (await $.tool.call({ tool: 'Bash', command: 'cat notes.txt' })) as {
    result?: unknown
  }
  expect(String(res.result)).not.toContain('AKIAIOSFODNN7EXAMPLE')
})
