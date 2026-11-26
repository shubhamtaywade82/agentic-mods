// Process-launch policy: argv quoting must round-trip through the Bash tokenizer, and the decision
// must match the Bash decision for the same words.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { quoteArgv, decideProcess } from '../src/command-policy'
import { parseCommand } from '../../../plugins/sdlc-guard/policies/command-parser'

test('quoteArgv round-trips hostile words through the Bash tokenizer unchanged', () => {
  const argv = [
    'echo',
    'two words',
    "it's",
    'say "hi"',
    'a;rm -rf /',
    '$(rm -rf /)',
    '`rm -rf /`',
    'x && y | z',
    'line\nbreak',
    'back\\slash',
    '*',
    '',
  ]
  const parsed = parseCommand(quoteArgv(argv))
  assert.equal(parsed.length, 1, 'quoting must not split the command')
  assert.deepEqual(parsed[0]?.argv, argv)
})

test('denies destructive argv that a person could also type into the shell', () => {
  const destructive: string[][] = [
    ['rm', '-rf', '/'],
    ['rm', '-r', 'dist'],
    ['rm', '-rf', 'a;rm -rf /'],
    ['git', 'push', '--force', 'origin', 'main'],
    ['git', 'push', 'origin', '+main'],
    ['git', 'reset', '--hard'],
    ['sh', '-c', 'rm -rf x'],
    ['bash', '-c', 'git push -f'],
    ['sudo', 'rm', '-rf', 'x'],
    ['kubectl', 'apply', '-f', 'deploy.yaml'],
    ['npm', 'publish'],
    ['psql', '-c', 'DROP TABLE users'],
  ]
  for (const argv of destructive) {
    const decision = decideProcess(argv)
    assert.equal(decision.kind, 'deny', `expected deny for ${JSON.stringify(argv)}`)
  }
})

test('allows ordinary verification argv', () => {
  const ordinary: string[][] = [
    ['git', 'status'],
    ['pnpm', 'test'],
    ['node', '--version'],
    ['rm', 'file.txt'],
    ['echo', 'rm -rf /'],
  ]
  for (const argv of ordinary) {
    assert.equal(decideProcess(argv).kind, 'allow', `expected allow for ${JSON.stringify(argv)}`)
  }
})

test('denies an empty command and a NUL byte, rather than passing them on', () => {
  assert.equal(decideProcess([]).kind, 'deny')
  assert.equal(decideProcess(['']).kind, 'deny')
  assert.equal(decideProcess(['echo', 'a\u0000b']).kind, 'deny')
})

test('known gap: an interpreter running inline code is not inspected', () => {
  // The classifier reads the program name and its flags, not the code an interpreter runs. verify
  // therefore executes only operator-declared argv, and this decision must not be relied on alone.
  assert.equal(decideProcess(['python3', '-c', 'import shutil; shutil.rmtree("/")']).kind, 'allow')
})
