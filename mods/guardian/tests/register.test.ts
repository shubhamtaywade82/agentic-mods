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
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({ tool: 'Bash', command: 'rm -rf /tmp/whatever' })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('guardian blocked this command')).toBe(true)
  expect(ran).toBe(false)
})

test('an ordinary Bash command runs unchanged', async ($, on) => {
  let seen: unknown = null
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen = e.command
    return { result: 'ok' }
  })

  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(seen).toBe('ls -la')
})

test('a Bash command carrying a real secret is denied', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({
      tool: 'Bash',
      command: 'curl -H "Authorization: Bearer ghp_16C7e42F292c6912E7710c838347Ae178B4a" https://api.example.com',
    })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('github-pat')).toBe(true)
  expect(ran).toBe(false)
})

test('a Write embedding a private key is denied', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Write' }, () => {
    ran = true
    return { result: 'ok' }
  })

  const res = (await $.tool
    .call({ tool: 'Write', file_path: 'key.txt', content: '-----BEGIN RSA PRIVATE KEY-----\nabc\n' })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('private-key')).toBe(true)
  expect(ran).toBe(false)
})

test('/guardian-report reflects what happened this session', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' }).catch(() => undefined)
  const answer = await $.command.run(reportInput)
  expect(answer.text).toContain('guardian session report')
  expect(answer.text).toContain('blocked')
})

// ----------------------------------------------- new: approval tier (destructive)

test('a destructive command is held, then denied when approval is not given', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: 'ok' }
  })
  // Default approval stub denies (fail-closed).
  $.approval._next = 'deny'

  const res = (await $.tool
    .call({ tool: 'Bash', command: 'rm -rf /tmp/build' })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string' && res.deny.includes('guardian')).toBe(true)
  expect(ran).toBe(false)
})

test('a destructive command proceeds when the human approves', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: 'ok' }
  })
  $.approval._next = 'approve'

  await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/build' })
  expect(ran).toBe(true)
})

test('a destructive command is denied when the host has no approval capability (timeout)', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  $.approval._next = 'timeout'

  const res = (await $.tool
    .call({ tool: 'Bash', command: 'rm -rf /tmp/build' })
    .catch((r: unknown) => r)) as { deny?: string }
  expect(typeof res?.deny === 'string').toBe(true)
})

// ----------------------------------- new: tool-result redaction (data protection)

test('secrets in a tool result are redacted before the model sees them', async ($, on) => {
  // The tool "returns" a secret; guardian's tool.result hook must scrub it.
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'token=AKIAIOSFODNN7EXAMPLE ok' }))

  let seen: unknown = null
  // Capture what the model would receive after guardian rewrites the result.
  on('tool.result', (_$, e) => {
    seen = e.result
    return { result: e.result }
  })

  await $.tool.call({ tool: 'Bash', command: 'echo hi' }).catch(() => undefined)
  // The redaction hook runs on the raw result; assert it rewrote the secret.
  const text = typeof seen === 'string' ? seen : JSON.stringify(seen)
  expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE')
  expect(text).toContain('[redacted:')
})
