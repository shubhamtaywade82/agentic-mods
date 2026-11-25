// Unit tests for guardian's new libs (gate + tool-result redaction). Run by
// `claude plugin test` alongside the lib tests.

import { expect, test } from 'claude-code/testing'
import {
  decideNoninteractive,
  diffStat,
  holdForBlast,
  holdForOversizedDiff,
  holdForSecretDiff,
  isHistoryMutating,
  isHistoryRead,
} from '../src/lib/gate'
import { redactResult, scan } from '../src/lib/secrets'

// ---------------------------------------------------------------- gate types

test('holdForBlast describes impact without echoing the command', () => {
  const held = holdForBlast('rm -rf /', { kind: 'rm-rf', why: 'recursively force-deletes files' })
  expect(held.reason).toBe('destructive-command')
  expect(held.previewComputed).toBe(true)
  expect(held.preview).toContain('rm-rf')
  expect(held.preview).not.toContain('rm -rf /')
})

test('holdForSecretDiff names kinds but never values', () => {
  const held = holdForSecretDiff('git push', ['github-pat'], { files: 2, insertions: 5, deletions: 1 })
  expect(held.reason).toBe('diff-contains-secret')
  expect(held.preview).toContain('github-pat')
  expect(held.preview).toContain('2 file(s)')
  expect(held.preview).toContain('+5')
})

test('holdForOversizedDiff refuses a diff it could not scan', () => {
  const held = holdForOversizedDiff('git commit', 600_000, 256 * 1024)
  expect(held.reason).toBe('diff-oversized')
  expect(held.previewComputed).toBe(false)
  expect(held.preview).toContain('256')
})

test('non-interactive sessions deny every held op (fail closed)', () => {
  expect(decideNoninteractive(holdForBlast('rm -rf x', { kind: 'rm-rf', why: 'x' }))).toBe('deny')
  expect(
    decideNoninteractive(holdForSecretDiff('git push', ['aws-access-key'], { files: 1, insertions: 0, deletions: 0 })),
  ).toBe('deny')
})

// ----------------------------------------------------------- git classification

test('isHistoryMutating flags commit/push/tag/rebase', () => {
  expect(isHistoryMutating('git commit -m "x"')).toBe(true)
  expect(isHistoryMutating('git push origin main')).toBe(true)
  expect(isHistoryMutating('git tag v1.0')).toBe(true)
  expect(isHistoryMutating('git rebase main')).toBe(true)
  expect(isHistoryMutating('git diff --cached')).toBe(false)
  expect(isHistoryMutating('git status')).toBe(false)
})

test('isHistoryRead flags only read operations', () => {
  expect(isHistoryRead('git diff')).toBe(true)
  expect(isHistoryRead('git log --oneline')).toBe(true)
  expect(isHistoryRead('git push')).toBe(false)
})

// ---------------------------------------------------------------- diffStat

test('diffStat counts files and +/- lines from a unified diff', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt',
    'index 111..222 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,2 +1,3 @@',
    ' context',
    '-removed line',
    '+added line',
    '+another added',
    'diff --git a/b.txt b/b.txt',
    '--- a/b.txt',
    '+++ b/b.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n')
  const stat = diffStat(diff)
  expect(stat.files).toBe(2)
  expect(stat.insertions).toBe(3)
  expect(stat.deletions).toBe(2)
})

test('diffStat is defensive on empty/garbage input', () => {
  expect(diffStat('')).toEqual({ files: 0, insertions: 0, deletions: 0 })
  expect(diffStat('not a diff at all')).toEqual({ files: 0, insertions: 0, deletions: 0 })
})

// -------------------------------------------------------- redactResult

test('redactResult redacts a plain string result', () => {
  const { result, findings } = redactResult('token=AKIAIOSFODNN7EXAMPLE here')
  expect(findings.length).toBeGreaterThanOrEqual(1)
  expect(result as string).toContain('[redacted:')
  expect(result as string).not.toContain('AKIAIOSFODNN7EXAMPLE')
})

test('redactResult walks stdout/text/content fields of an object', () => {
  const obj = {
    stdout: 'AKIAIOSFODNN7EXAMPLE',
    text: 'Bearer ghp_16C7e42F292c6912E7710c838347Ae178B4a',
    meta: { untouched: true },
  }
  const { result, findings } = redactResult(obj)
  const out = result as typeof obj
  expect(findings.length).toBeGreaterThanOrEqual(2)
  expect(out.stdout).not.toContain('AKIA')
  expect(out.text).not.toContain('ghp_')
  expect(out.meta).toEqual({ untouched: true })
})

test('redactResult does not mutate the original object', () => {
  const obj = { stdout: 'AKIAIOSFODNN7EXAMPLE' }
  redactResult(obj)
  expect(obj.stdout).toBe('AKIAIOSFODNN7EXAMPLE')
})

test('redactResult handles arrays and null without throwing', () => {
  const { result: r1 } = redactResult(['AKIAIOSFODNN7EXAMPLE', 'plain'])
  expect(r1 as unknown[]).toHaveLength(2)
  expect(redactResult(null).result).toBeNull()
  expect(redactResult(42).result).toBe(42)
})

test('redactResult returns findings for the report summary', () => {
  const { findings } = redactResult('AKIAIOSFODNN7EXAMPLE and AKIAI44QH8DHBEXAMPLE')
  const aws = findings.filter((f) => f.kind === 'aws-access-key')
  expect(aws.length).toBe(2)
  expect(scan(JSON.stringify(findings.map((f) => ({ kind: f.kind, index: f.index }))))).toEqual([]) // kinds and metadata never leak secrets
})
