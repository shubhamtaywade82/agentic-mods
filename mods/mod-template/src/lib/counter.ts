// Pure counter logic for mod-template. No Claude Code imports here so this
// file can be type-checked and unit-tested without a session.

/**
 * A counter of tool-call ATTEMPTS. It increments before the call is allowed
 * through, so it includes calls that later fail or are denied by another hook.
 */
export class AttemptCounter {
  private count = 0

  increment(): number {
    this.count += 1
    return this.count
  }

  get value(): number {
    return this.count
  }

  reset(): void {
    this.count = 0
  }
}

/** Wording for user-facing strings; exported so tests pin it. */
export const LABELS = {
  counter: 'tool-call attempts',
  tally: (n: number) => `Claude has made ${n} tool-call attempts since this mod loaded`,
} as const
