# GOLDEN-001: Slugify

## Overview
Provide a slugify function that turns a title into a URL slug.

## Problem
Titles are used in URLs and need a predictable form: lowercase, with words separated by single dashes.

## Scope
### In Scope
- slugify(text) returning a lowercase, dash-separated slug

### Out of Scope
- Transliteration of non-ASCII letters

## Actors
- Developer: calls slugify from application code

## Functional Requirements
- REQ-001: slugify lowercases its input and trims surrounding whitespace
- REQ-002: each run of characters that are not ASCII letters or digits becomes a single dash
- REQ-003: leading and trailing dashes are removed

## Non-Functional Requirements
- NFR-001: slugify is pure and synchronous

## Acceptance Criteria
- ACC-001: slugify('  Hello, World!  ') returns 'hello-world'
- ACC-002: slugify('') returns an empty string

## Edge Cases
- Input made only of punctuation returns an empty string

## Dependencies
- None

## Risks
- RISK-001 (low): Non-ASCII letters are removed, which is accepted for this feature
