/**
 * TDD state machine and failure classification. Transitions are explicit; a RED result counts
 * only when the failure is behavioral, not a compile, import or environment error.
 */
export type TddPhase = 'idle' | 'red' | 'green' | 'refactor' | 'complete'

export type FailureKind = 'behavioral' | 'environment' | 'unknown'

const ENVIRONMENT =
  /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|SyntaxError|error TS\d+|Could not resolve|command not found|ENOENT|ECONNREFUSED|compilation failed|cannot find symbol|undefined reference/i
const BEHAVIORAL =
  /AssertionError|AssertionFailed|expect\(|toBe\(|toEqual\(|Expected|Received|assert(ion)?\s|\bFAIL\b|\d+ failed|failures?:\s*[1-9]/i

/** Classifies a failing test run from its output. Environment errors take precedence. */
export function classifyFailure(stdout: string, stderr: string): FailureKind {
  const text = `${stdout}\n${stderr}`
  if (ENVIRONMENT.test(text)) return 'environment'
  if (BEHAVIORAL.test(text)) return 'behavioral'
  return 'unknown'
}

export type TddEvent = 'red-verified' | 'red-rejected' | 'green-verified' | 'green-rejected' | 'refactor' | 'complete' | 'exception'

export type TddTransition = { ok: true; phase: TddPhase } | { ok: false; reason: string }

/** Legal transitions. A rejected run leaves the phase unchanged. */
export function nextPhase(current: TddPhase, event: TddEvent): TddTransition {
  switch (event) {
    case 'red-verified':
      if (current === 'idle' || current === 'refactor' || current === 'complete') return { ok: true, phase: 'red' }
      return { ok: false, reason: `RED is not valid from ${current}` }
    case 'green-verified':
      if (current === 'red') return { ok: true, phase: 'green' }
      return { ok: false, reason: `GREEN is not valid from ${current}` }
    case 'refactor':
      if (current === 'green') return { ok: true, phase: 'refactor' }
      return { ok: false, reason: `REFACTOR needs GREEN first; now ${current}` }
    case 'complete':
      if (current === 'green' || current === 'refactor') return { ok: true, phase: 'complete' }
      return { ok: false, reason: `a cycle completes from GREEN or REFACTOR; now ${current}` }
    case 'red-rejected':
    case 'green-rejected':
    case 'exception':
      return { ok: true, phase: current }
  }
}

/**
 * Whether a production-code write is consistent with the phase. Production code is written only
 * after a verified RED (implementation) or during REFACTOR. Test files are always allowed.
 */
export function productionWriteAllowed(phase: TddPhase): boolean {
  return phase === 'red' || phase === 'refactor'
}

const TEST_PATH = /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/|_test\.(go|py)$|(^|\/)test_[^/]*\.py$)/

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path.replace(/\\/g, '/'))
}
