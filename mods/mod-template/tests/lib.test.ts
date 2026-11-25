// Pure unit tests for mod-template's libs. These run alongside the session
// tests when `claude plugin test` executes the tests/ directory, and they can
// also be type-checked standalone with a pinned tsc.

import { expect, test } from 'claude-code/testing'
import { AttemptCounter, LABELS } from '../hooks/lib/counter'
import { formatUsage } from '../hooks/lib/usage'

// ---------------------------------------------------------------- counter

test('AttemptCounter increments and reports attempts', () => {
  const c = new AttemptCounter()
  expect(c.value).toBe(0)
  expect(c.increment()).toBe(1)
  expect(c.increment()).toBe(2)
  expect(c.value).toBe(2)
})

test('AttemptCounter resets', () => {
  const c = new AttemptCounter()
  c.increment()
  c.reset()
  expect(c.value).toBe(0)
})

test('tally label counts attempts, not successes', () => {
  expect(LABELS.tally(3)).toBe('Claude has made 3 tool-call attempts since this mod loaded')
})

// ------------------------------------------------------------------ usage

test('formatUsage renders context and a single rate-limit window', () => {
  const text = formatUsage({
    context: { tokens: 12000, window: 200000 },
    rateLimits: [{ kind: 'context', percentUsed: 42 }],
  })
  expect(text).toBe('context: 12000/200000 tokens; context 42% used')
})

test('formatUsage renders no plan-limit data when rateLimits is empty', () => {
  const text = formatUsage({ context: { tokens: 0, window: 200000 }, rateLimits: [] })
  expect(text).toBe('context: 0/200000 tokens; no plan-limit data')
})

test('formatUsage renders multiple rate-limit windows in order', () => {
  const text = formatUsage({
    context: { tokens: 5, window: 10 },
    rateLimits: [
      { kind: 'weekly', percentUsed: 80 },
      { kind: 'daily', percentUsed: 10 },
    ],
  })
  expect(text).toBe('context: 5/10 tokens; weekly 80% used, daily 10% used')
})

test('formatUsage handles missing or malformed usage data defensively', () => {
  // Non-finite numbers fall back to 0 instead of rendering NaN/undefined.
  const text = formatUsage({
    context: { tokens: Number.NaN, window: Number.NaN },
    rateLimits: [{ kind: 'weekly', percentUsed: Number.NaN }],
  })
  expect(text).toBe('context: 0/0 tokens; weekly 0% used')
})
