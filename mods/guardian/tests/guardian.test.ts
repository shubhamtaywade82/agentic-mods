// Unit tests for guardian's pure libs. Run by `claude plugin test`.

import { expect, test } from 'claude-code/testing'
import { checkCommand, denyMessage } from '../src/lib/blast'
import { denyReason, hasHighSignal, redact, scan, summarize } from '../src/lib/secrets'

// ------------------------------------------------------------------ blast

test('blocks rm -rf in its common spellings', () => {
  expect(checkCommand('rm -rf /tmp/build')?.kind).toBe('rm-rf')
  expect(checkCommand('rm -fr dir')?.kind).toBe('rm-rf')
  expect(checkCommand('rm --recursive --force dir')?.kind).toBe('rm-rf')
})

test('blocks force pushes but allows --force-with-lease', () => {
  expect(checkCommand('git push origin main -f')?.kind).toBe('force-push')
  expect(checkCommand('git push --force origin main')?.kind).toBe('force-push')
  expect(checkCommand('git push --force-with-lease origin main')).toBeNull()
  expect(checkCommand('git push origin main')).toBeNull()
})

test('blocks schema migrations and prod database writes', () => {
  expect(checkCommand('bin/rails db:migrate')?.kind).toBe('db-migration')
  expect(checkCommand('npx prisma migrate deploy')?.kind).toBe('db-migration')
  expect(checkCommand('psql -h prod-db.example.com -c "UPDATE users"')?.kind).toBe('prod-db-write')
})

test('does not touch ordinary commands', () => {
  expect(checkCommand('ls -la')).toBeNull()
  expect(checkCommand('git push origin feature/x')).toBeNull()
  expect(checkCommand('rm single-file.txt')).toBeNull()
  expect(checkCommand('')).toBeNull()
})

test('deny message names the impact without echoing the command', () => {
  const m = checkCommand('rm -rf /')
  expect(m).not.toBeNull()
  const msg = denyMessage(m!)
  expect(msg).toContain('rm-rf')
  expect(msg).toContain('recursively force-deletes')
  expect(msg).not.toContain('rm -rf /')
})

// ---------------------------------------------------------------- secrets

test('detects AWS access keys, GitHub PATs and private key headers', () => {
  const text = [
    'key = AKIAIOSFODNN7EXAMPLE',
    'token: ghp_16C7e42F292c6912E7710c838347Ae178B4a',
    '-----BEGIN RSA PRIVATE KEY-----',
  ].join('\n')
  const kinds = scan(text).map((f) => f.kind)
  expect(kinds).toContain('aws-access-key')
  expect(kinds).toContain('github-pat')
  expect(kinds).toContain('private-key')
})

test('scan finds multiple distinct secrets of the same kind', () => {
  const text = 'first AKIAIOSFODNN7EXAMPLE and second AKIAI44QH8DHBEXAMPLE'
  const findings = scan(text)
  const aws = findings.filter((f) => f.kind === 'aws-access-key')
  expect(aws.length).toBe(2)
  // Value-anchored: the exact substrings must be found, not just the kind.
  expect(aws[0]!.value).toBe('AKIAIOSFODNN7EXAMPLE')
  expect(aws[1]!.value).toBe('AKIAI44QH8DHBEXAMPLE')
  expect(aws[0]!.index).toBeLessThan(aws[1]!.index)
})

test('scan does not match prose or short strings', () => {
  expect(scan('the AKIA pattern is documented in AWS docs').filter((f) => f.kind === 'aws-access-key')).toEqual([])
  expect(scan('PASSWORD=short').filter((f) => f.kind === 'env-assignment')).toEqual([])
  expect(scan('')).toEqual([])
})

test('redact replaces the exact matched values with kind tags', () => {
  const text = 'export GITHUB_TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a'
  const out = redact(text, scan(text))
  expect(out).not.toContain('ghp_16C7e42F292c6912E7710c838347Ae178B4a')
  expect(out).toContain('[redacted:')
})

test('redact handles multiple findings across the text in order', () => {
  const text = 'a AKIAIOSFODNN7EXAMPLE b AKIAI44QH8DHBEXAMPLE c'
  const out = redact(text, scan(text))
  expect(out).toBe('a [redacted:aws-access-key] b [redacted:aws-access-key] c')
})

test('redact collapses overlapping findings into one span', () => {
  // env-assignment span contains the whole line; the inner finding merges in.
  const text = 'API_KEY=AKIAIOSFODNN7EXAMPLE'
  const out = redact(text, scan(text))
  expect(out.match(/\[redacted:/g)?.length).toBe(1)
})

test('high-signal kinds block; maybe kinds only redact', () => {
  const high = scan('AKIAIOSFODNN7EXAMPLE')
  expect(hasHighSignal(high)).toBe(true)
  expect(denyReason(high)).toContain('aws-access-key')

  const maybe = scan('TOKEN=some-plaintext-value-here')
  expect(hasHighSignal(maybe)).toBe(false)
  expect(denyReason(maybe)).toBeNull()
})

test('summarize counts by kind without values', () => {
  const s = summarize(scan('AKIAIOSFODNN7EXAMPLE AKIAI44QH8DHBEXAMPLE'))
  expect(s['aws-access-key']).toBe(2)
  expect(JSON.stringify(s)).not.toContain('AKIA')
})
