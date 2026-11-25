// Unit tests for design-patterns' pure lib. Run by `claude plugin test`.

import { expect, test } from 'claude-code/testing'
import { PATTERNS, byCategory, findPattern, renderAnswer } from '../src/lib/index'

// ------------------------------------------------------------------- index

test('covers all 22 GoF patterns exactly once', () => {
  expect(PATTERNS.length).toBe(22)
  const names = new Set(PATTERNS.map((p) => p.name))
  expect(names.size).toBe(22)
  expect(names.has('Factory Method')).toBe(true)
  expect(names.has('Visitor')).toBe(true)
})

test('categories split 5 / 7 / 10', () => {
  expect(byCategory('creational').length).toBe(5)
  expect(byCategory('structural').length).toBe(7)
  expect(byCategory('behavioral').length).toBe(10)
})

test('findPattern matches exactly, fuzzily and case-insensitively', () => {
  expect(findPattern('Strategy')?.name).toBe('Strategy')
  expect(findPattern('strategy')?.name).toBe('Strategy')
  expect(findPattern('chain of resp')?.name).toBe('Chain of Responsibility')
  expect(findPattern('')).toBeNull()
  expect(findPattern('not-a-pattern')).toBeNull()
})

// ---------------------------------------------------------------- renderer

test('bare /patterns shows usage', () => {
  const out = renderAnswer('')
  expect(out).toContain('/patterns <name>')
  expect(out).toContain('list <category>')
})

test('/patterns list behavioral lists all 10 with idioms', () => {
  const out = renderAnswer('list behavioral')
  expect(out).toContain('behavioral (10)')
  expect(out).toContain('Strategy')
  expect(out).toContain('Idiom first')
})

test('/patterns list rejects unknown categories', () => {
  expect(renderAnswer('list nonsense')).toContain('Usage: /patterns list')
})

test('/patterns strategy renders a pattern card', () => {
  const out = renderAnswer('strategy')
  expect(out).toContain('Strategy (behavioral)')
  expect(out).toContain('Use when')
  expect(out).toContain('Idiom first')
})

test('a described problem suggests candidate patterns', () => {
  const out = renderAnswer('switch-on-type smells everywhere in our visitor nodes')
  expect(out).toContain('consider')
  expect(out).toContain('Visitor')
})

test('unknown input falls back to usage help', () => {
  const out = renderAnswer('zzzz-not-a-thing')
  expect(out).toContain('No pattern named')
})
