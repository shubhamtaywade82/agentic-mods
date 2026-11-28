// Strength evidence: the mutation score is parsed from real tool output, judged against the
// threshold, and an unknown score (timeout, crash, unparsable output) is incomplete — never a
// fabricated pass. Configuration is opt-in and a required strength check without the section
// enabled is a reported mistake, not a silently enforced gate.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeMutationScore,
  detectStrengthCommand,
  type MutationTool,
  mutableFilesOf,
  mutationToolOfArgv,
  parseStrengthOutput,
  resolveStrengthStatus,
  strengthFileArgs,
  strengthTrend,
} from '../src/strength'
import { analyzeCommand, CHECKS, isCheckName } from '../src/classify'
import { parseConfig } from '../src/config'
import { evaluateChecks, type CheckRecord } from '../src/evidence'

const counts = (generated: number, killed: number, survived = generated - killed) => ({
  mutantsGenerated: generated,
  mutantsKilled: killed,
  mutantsSurvived: survived,
})

test('computeMutationScore is round(100 * killed / generated) and null without mutants', () => {
  assert.equal(computeMutationScore(counts(50, 37)), 74)
  assert.equal(computeMutationScore(counts(3, 2)), 67)
  assert.equal(computeMutationScore(counts(0, 0)), null)
})

test('resolveStrengthStatus fails closed on an unknown score', () => {
  assert.equal(resolveStrengthStatus(null, 60), 'incomplete')
  assert.equal(resolveStrengthStatus(59, 60), 'failed')
  assert.equal(resolveStrengthStatus(60, 60), 'passed')
})

test('parseStrengthOutput reads a StrykerJS clear-text score line', () => {
  const output = [
    'All tests',
    'Killed : 37 (74%)',
    'Survived: 13 (26%)',
    'Mutation score: 74.00%',
    'Mutation score based on covered code: 78.57%',
  ].join('\n')
  const parsed = parseStrengthOutput('stryker', output)
  assert.notEqual(parsed.score, null)
  assert.equal(parsed.score, 74)
  assert.notEqual(parsed.counts, null)
  if (parsed.counts !== null) {
    assert.equal(parsed.counts.mutantsKilled, 37)
    assert.equal(parsed.counts.mutantsSurvived, 13)
  }
})

test('parseStrengthOutput reads mutmut counters, timeouts as killed', () => {
  const output = '⠏ 42/42\t🎉 41  ⏰ 0  🤔 0  🙁 1'
  const parsed = parseStrengthOutput('mutmut', output)
  assert.notEqual(parsed.counts, null)
  if (parsed.counts !== null) {
    assert.equal(parsed.counts.mutantsGenerated, 42)
    assert.equal(parsed.counts.mutantsKilled, 41)
    assert.equal(parsed.counts.mutantsSurvived, 1)
  }
  assert.equal(parsed.score, 98)
})

test('parseStrengthOutput reads mutant JSON summaries conservatively', () => {
  const output = JSON.stringify({
    summary: { generated: 20, killed: 15, timeout: 2, not_covered: 1, no_tests: 0 },
  })
  const parsed = parseStrengthOutput('mutant', output)
  assert.notEqual(parsed.counts, null)
  if (parsed.counts !== null) {
    // 15 killed + 2 timeout count as caught; the not-covered mutant is survived.
    assert.equal(parsed.counts.mutantsKilled, 17)
    assert.equal(parsed.counts.mutantsSurvived, 2)
    assert.equal(parsed.counts.mutantsGenerated, 20)
  }
  assert.equal(parsed.score, 85)
})

test('parseStrengthOutput reads gremlins tallies and prefers its own score line', () => {
  const output = 'Test efficacy: 80.00%\nKilled: 40, Lived: 10, Not covered: 2'
  const parsed = parseStrengthOutput('gremlins', output)
  assert.equal(parsed.score, 80)
  assert.notEqual(parsed.counts, null)
  if (parsed.counts !== null) {
    assert.equal(parsed.counts.mutantsGenerated, 50)
    assert.equal(parsed.counts.mutantsKilled, 40)
  }
})

test('parseStrengthOutput reads cargo-mutants tallies', () => {
  const output = 'src/lib.rs: test ok\n18 mutants tested: 15 killed, 3 missed\nmutation score: 83.33%'
  const parsed = parseStrengthOutput('cargo-mutants', output)
  assert.equal(parsed.score, 83)
  assert.notEqual(parsed.counts, null)
  if (parsed.counts !== null) {
    assert.equal(parsed.counts.mutantsGenerated, 18)
    assert.equal(parsed.counts.mutantsKilled, 15)
    assert.equal(parsed.counts.mutantsSurvived, 3)
  }
})

test('parseStrengthOutput refuses to guess on output it cannot read', () => {
  const parsed = parseStrengthOutput('stryker', 'compilation failed: cannot find module')
  assert.equal(parsed.score, null)
  assert.equal(parsed.counts, null)
  const generic = parseStrengthOutput(null, 'all good')
  assert.equal(generic.score, null)
})

test('detectStrengthCommand requires the tool to be declared, never installs it', () => {
  const stryker = detectStrengthCommand({
    packageJson: '{"devDependencies":{"@stryker-mutator/core":"^8.0.0"}}',
    pyproject: null,
    requirements: null,
    gemfile: null,
    goMod: null,
    cargoToml: null,
    dotnet: null,
  })
  assert.notEqual(stryker, null)
  assert.equal(stryker?.tool, 'stryker')
  assert.deepEqual(stryker?.argv, ['npx', 'stryker', 'run'])

  const undeclared = detectStrengthCommand({
    packageJson: '{"devDependencies":{"typescript":"5.0.0"}}',
    pyproject: null,
    requirements: null,
    gemfile: null,
    goMod: null,
    cargoToml: null,
    dotnet: null,
  })
  assert.equal(undeclared, null)

  const python = detectStrengthCommand({
    packageJson: null,
    pyproject: null,
    requirements: 'mutmut~=3.0.0\npytest\n',
    gemfile: null,
    goMod: null,
    cargoToml: null,
    dotnet: null,
  })
  assert.notEqual(python, null)
  assert.equal(python?.tool, 'mutmut')

  const rust = detectStrengthCommand({
    packageJson: null,
    pyproject: null,
    requirements: null,
    gemfile: null,
    goMod: null,
    cargoToml: '[package]\nname = "x"',
    dotnet: null,
  })
  assert.notEqual(rust, null)
  assert.deepEqual(rust?.argv, ['cargo', 'mutants'])

  const ruby = detectStrengthCommand({
    packageJson: null,
    pyproject: null,
    requirements: null,
    gemfile: "gem 'rspec'\n",
    goMod: null,
    cargoToml: null,
    dotnet: null,
  })
  assert.equal(ruby, null)
})

test('mutableFilesOf keeps source files and drops tests and vendored code', () => {
  assert.deepEqual(
    mutableFilesOf([
      'src/sum.ts',
      'src/sum.test.ts',
      'README.md',
      'node_modules/left-pad/index.js',
      'lib/calc.py',
    ]),
    ['src/sum.ts', 'lib/calc.py'],
  )
})

test('strengthFileArgs scopes the tools that support file selection', () => {
  assert.deepEqual(strengthFileArgs('stryker', ['src/a.ts', 'src/b.ts']), [
    '--mutate',
    'src/a.ts,src/b.ts',
  ])
  assert.deepEqual(strengthFileArgs('cargo-mutants', ['src/lib.rs']), ['--file', 'src/lib.rs'])
  assert.deepEqual(strengthFileArgs('go-mutesting', ['a.go']), ['a.go'])
  assert.equal(strengthFileArgs('mutant', ['lib/x.rb']), null)
  assert.equal(strengthFileArgs('stryker', []), null)
})

test('mutationToolOfArgv recognizes declared mutation commands', () => {
  const cases: Array<[string[], MutationTool | null]> = [
    [['npx', 'stryker', 'run'], 'stryker'],
    [['dotnet', 'stryker'], 'stryker-net'],
    [['cargo', 'mutants'], 'cargo-mutants'],
    [['mutmut', 'run'], 'mutmut'],
    [['npm', 'test'], null],
  ]
  for (const [argv, expected] of cases) assert.equal(mutationToolOfArgv(argv), expected)
})

test('classify names strength a check and recognizes mutation commands', () => {
  assert.ok(CHECKS.includes('strength'))
  assert.ok(isCheckName('strength'))
  assert.equal(analyzeCommand('npx stryker run').checks.includes('strength'), true)
  assert.equal(analyzeCommand('mutmut run').checks.includes('strength'), true)
  assert.equal(analyzeCommand('cargo mutants').checks.includes('strength'), true)
  assert.equal(analyzeCommand('dotnet stryker').checks.includes('strength'), true)
  assert.equal(analyzeCommand('grep mutation score report.txt').checks.length, 0)
})

test('the strength config section is opt-in and validated', () => {
  const off = parseConfig(undefined)
  assert.equal(off.value.evidence.strength.enabled, false)
  assert.equal(off.value.evidence.strength.threshold, 60)
  assert.equal(off.value.evidence.strength.budgetMs, 120_000)
  assert.equal(off.value.evidence.strength.scope, 'diff')

  const on = parseConfig({
    evidence: {
      required: ['build', 'test', 'strength'],
      strength: { enabled: true, threshold: 70, budgetMs: 60_000, scope: 'suite' },
    },
  })
  assert.deepEqual(on.errors, [])
  assert.equal(on.value.evidence.strength.enabled, true)
  assert.equal(on.value.evidence.strength.threshold, 70)
  assert.deepEqual(on.value.evidence.required, ['build', 'test', 'strength'])

  const invalid = parseConfig({
    evidence: { strength: { enabled: true, threshold: 140, budgetMs: 0, scope: 'everything' } },
  })
  // Threshold, budget and scope fall back to defaults and the mistakes are reported.
  assert.equal(invalid.value.evidence.strength.threshold, 60)
  assert.equal(invalid.value.evidence.strength.budgetMs, 120_000)
  assert.equal(invalid.value.evidence.strength.scope, 'diff')
  assert.equal(invalid.errors.length, 3)

  const mismatch = parseConfig({
    evidence: { required: ['test', 'strength'], strength: { enabled: false } },
  })
  // A required strength check without the section enabled is reported and skipped,
  // so the gate cannot refuse every commit on a check that can never pass.
  assert.equal(mismatch.value.evidence.required.includes('strength'), false)
  assert.equal(mismatch.errors.length, 1)
})

const NOW = 1_700_000_000_000
const FINGERPRINT = 'fp-1'

function strengthRecord(overrides: {
  status: 'passed' | 'failed' | 'incomplete'
  score?: number | null
  fingerprintOfRun?: string
}): CheckRecord {
  const score = overrides.score ?? null
  return {
    check: 'strength',
    argv: ['npx', 'stryker', 'run'],
    exitCode: 0,
    fingerprint: overrides.fingerprintOfRun ?? FINGERPRINT,
    ranAt: NOW,
    durationMs: 1_000,
    source: 'run',
    strength: {
      tool: 'stryker',
      status: overrides.status,
      score,
      counts:
        score === null
          ? null
          : {
              mutantsGenerated: 50,
              mutantsKilled: Math.round((score / 100) * 50),
              mutantsSurvived: 50 - Math.round((score / 100) * 50),
            },
      scope: 'diff',
      threshold: 60,
      budgetMs: 120_000,
      durationMs: 1_000,
      summary: `mutation score ${score ?? 'unknown'}%`,
    },
  }
}

function evaluate(record: CheckRecord | null): string {
  const statuses = evaluateChecks(
    ['strength'],
    record === null ? new Map() : new Map([['strength', record]]),
    FINGERPRINT,
    NOW,
    30 * 60_000,
  )
  const status = statuses[0]
  assert.notEqual(status, undefined)
  return `${status?.verdict}:${status?.reason}`
}

test('a strength record is judged by the score, not the exit code', () => {
  assert.match(evaluate(strengthRecord({ status: 'passed', score: 74 })), /^PASS:mutation score 74%/)
  assert.match(
    evaluate(strengthRecord({ status: 'failed', score: 42 })),
    /^FAIL:mutation score 42%.*below threshold 60%$/,
  )
  // The exit code does not decide strength: mutation tools exit non-zero for their own
  // reasons, and the score is the evidence.
  const exited = strengthRecord({ status: 'passed', score: 74 })
  exited.exitCode = 1
  assert.match(evaluate(exited), /^PASS:mutation score 74%/)
})

test('an incomplete strength run is UNKNOWN, never silently skipped', () => {
  const verdict = evaluate(
    strengthRecord({ status: 'incomplete', score: null }),
  )
  assert.match(verdict, /^UNKNOWN:incomplete: mutation score unknown%/)
})

test('a strength record without a mutation result is UNKNOWN', () => {
  const record: CheckRecord = {
    check: 'strength',
    argv: [],
    exitCode: 0,
    fingerprint: FINGERPRINT,
    ranAt: NOW,
    durationMs: 0,
    source: 'run',
  }
  assert.match(evaluate(record), /^UNKNOWN:no mutation result recorded/)
  assert.match(evaluate(null), /^UNKNOWN:not run/)
})

test('a passed strength record goes stale like every other check', () => {
  const statuses = evaluateChecks(
    ['strength'],
    new Map([
      [
        'strength',
        strengthRecord({ status: 'passed', score: 74, fingerprintOfRun: 'older-fingerprint' }),
      ],
    ]),
    FINGERPRINT,
    NOW,
    30 * 60_000,
  )
  assert.equal(statuses[0]?.verdict, 'STALE')
  const aged = evaluateChecks(
    ['strength'],
    new Map([['strength', strengthRecord({ status: 'passed', score: 74 })]]),
    FINGERPRINT,
    NOW + 31 * 60_000,
    30 * 60_000,
  )
  assert.equal(aged[0]?.verdict, 'STALE')
})

test('strengthTrend shows recent known scores, oldest to newest', () => {
  const records = [
    { check: 'test' as const },
    { check: 'strength' as const, strength: { status: 'passed' as const, score: 62, tool: null, counts: null, scope: 'diff' as const, threshold: 60, budgetMs: 1, durationMs: 0, summary: '' } },
    { check: 'strength' as const, strength: { status: 'incomplete' as const, score: null, tool: null, counts: null, scope: 'diff' as const, threshold: 60, budgetMs: 1, durationMs: 0, summary: 'budget exceeded' } },
    { check: 'strength' as const, strength: { status: 'passed' as const, score: 71, tool: null, counts: null, scope: 'diff' as const, threshold: 60, budgetMs: 1, durationMs: 0, summary: '' } },
  ]
  assert.equal(strengthTrend(records), '62 \u2192 71')
  assert.equal(strengthTrend([{ check: 'test' }]), '')
})
