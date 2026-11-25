// Minimal structural stub of 'claude-code/testing', used ONLY for offline
// type-checking of this library's test files. Shape only; the real module
// runs the tests inside `claude plugin test`.

declare module 'claude-code/testing' {
  export function test(name: string, fn: ($: TestApi, on: TestOn) => Promise<void> | void): void

  interface Expectation {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: string): void
    toMatch(pattern: RegExp): void
    toBeNull(): void
    toBeUndefined(): void
    toBeTruthy(): void
    toBeFalsy(): void
    toBeGreaterThan(n: number): void
    toBeGreaterThanOrEqual(n: number): void
    toBeLessThan(n: number): void
    toBeLessThanOrEqual(n: number): void
    toHaveLength(n: number): void
    not: {
      toBe(expected: unknown): void
      toContain(expected: string): void
      toMatch(pattern: RegExp): void
      toBeNull(): void
      toBeUndefined(): void
    }
  }

  export function expect(actual: unknown): Expectation

  interface CommandRunInput {
    command: string
    args: string
    origin: { kind: string; name: string }
    presentation: { isFullscreen: boolean; columns: number }
  }

  /** A denied tool call resolves to this; anything else is tool-specific. */
  interface ToolCallResult {
    deny?: string
    result?: unknown
    [k: string]: unknown
  }

  interface TestApi {
    command: {
      run(input: CommandRunInput): Promise<{ text: string }>
    }
    tool: {
      call(input: { tool: string; [k: string]: unknown }): Promise<ToolCallResult>
    }
    turn: {
      complete(input: never): Promise<unknown>
    }
    session: {
      usage(): Promise<{
        context: { tokens: number; window: number }
        rateLimits: Array<{ kind: string; percentUsed: number }>
      }>
      start(input: never): Promise<unknown>
      measure(input: never): Promise<unknown>
    }
    /**
     * Stubbed host approval. Default denies (fail-closed). Tests override by
     * setting $.approval._next before triggering a held call.
     */
    approval: {
      _next?: 'approve' | 'deny' | 'timeout'
      ask(input: {
        command: string
        reason: string
        preview: string
      }): Promise<'approve' | 'deny' | 'timeout'>
    }
  }

  interface StubEvent {
    tool: string
    command?: string
    /** Present on tool.result events; the value the tool returned. */
    result?: unknown
    [k: string]: unknown
  }

  type StubResult =
    | { result?: unknown; deny?: string }
    | { text: string }
    | { value: unknown }
    | Record<string, unknown>
    | void

  interface TestOn {
    (event: string, hook: ($: unknown, e: StubEvent, next?: unknown) => StubResult): void
    (
      event: string,
      matcher: { tool?: string; command?: string },
      hook: ($: unknown, e: StubEvent, next?: unknown) => StubResult,
    ): void
  }
}
