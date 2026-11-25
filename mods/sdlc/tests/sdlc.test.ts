// Unit tests for sdlc's pure lib. Run by `claude plugin test`.

import { expect, test } from 'claude-code/testing'
import { COMMANDS, LIFECYCLE, buildCommandPrompt, slugify } from '../src/lib/commands'

// ---------------------------------------------------------------- registry

test('registers all 11 lifecycle commands at session start', () => {
  const names = COMMANDS.map((c) => c.name)
  expect(names).toEqual([
    'sdlc-init',
    'sdlc-feature',
    'sdlc-prd',
    'sdlc-spec',
    'sdlc-plan',
    'sdlc-tdd',
    'sdlc-review',
    'sdlc-debug',
    'sdlc-refactor',
    'sdlc-ship',
    'sdlc-audit',
  ])
})

test('every command has a non-empty description', () => {
  for (const c of COMMANDS) {
    expect(c.description.length > 10).toBe(true)
  }
})

test('lifecycle covers all 8 stages in order', () => {
  expect(LIFECYCLE.length).toBe(8)
  expect(LIFECYCLE[0]).toBe('01 Clarify/PRD')
  expect(LIFECYCLE[7]).toBe('08 Release')
})

// ---------------------------------------------------------------- slugify

test('slugify turns a feature description into a file-safe slug', () => {
  expect(slugify('Add password reset via email!')).toBe('add-password-reset-via-email')
})

test('slugify handles punctuation, casing, padding and length', () => {
  expect(slugify('  Fix: N+1 queries in /api/v2/orders  ')).toBe('fix-n-1-queries-in-api-v2-orders')
  expect(slugify('UPPER CASE')).toBe('upper-case')
  expect(slugify('!!!')).toBe('')
  const long = slugify('x'.repeat(200))
  expect(long.length <= 60).toBe(true)
})

// -------------------------------------------------------------- prompts

test('sdlc-feature prompt includes the slug, stages and gates', () => {
  const p = buildCommandPrompt('sdlc-feature', 'Add magic link login')
  expect(p.includes('Add magic link login')).toBe(true)
  expect(p.includes('docs/prd/add-magic-link-login.md')).toBe(true)
  expect(p.includes('approval')).toBe(true)
})

test('sdlc-prd prompt asks questions first and forbids code', () => {
  const p = buildCommandPrompt('sdlc-prd', 'Export to CSV')
  expect(p.includes('5 clarifying questions')).toBe(true)
  expect(p.includes('Do not write any code')).toBe(true)
  expect(p.includes('docs/prd/export-to-csv.md')).toBe(true)
})

test('sdlc-tdd prompt follows red-green-refactor and stops on scope growth', () => {
  const p = buildCommandPrompt('sdlc-tdd', '')
  expect(p.includes('Red:')).toBe(true)
  expect(p.includes('Green:')).toBe(true)
  expect(p.includes('2x')).toBe(true)
})

test('sdlc-review prompt outputs severity-ranked findings and a verdict', () => {
  const p = buildCommandPrompt('sdlc-review', '')
  expect(p.includes('Blocker/Major/Minor/Nit')).toBe(true)
  expect(p.includes('Approve or Request changes')).toBe(true)
})

test('sdlc-ship prompt verifies first and waits for confirmation to push', () => {
  const p = buildCommandPrompt('sdlc-ship', '')
  expect(p.includes('full tests, lint, type-check')).toBe(true)
  expect(p.includes('after I confirm')).toBe(true)
})

test('every registered command has a prompt builder case', () => {
  for (const c of COMMANDS) {
    const p = buildCommandPrompt(c.name, 'sample topic')
    expect(p.startsWith('Unknown sdlc command')).toBe(false)
    expect(p.length > 40).toBe(true)
  }
})

test('unknown sdlc command is rejected explicitly', () => {
  expect(buildCommandPrompt('sdlc-nonsense', '').startsWith('Unknown sdlc command')).toBe(true)
})

test('no prompt points at skill files the mod does not ship', () => {
  for (const command of COMMANDS) {
    expect(buildCommandPrompt(command.name, 'checkout')).not.toMatch(/sdlc skill|skill template/)
  }
})
