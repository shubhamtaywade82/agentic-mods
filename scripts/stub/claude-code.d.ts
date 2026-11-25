// Minimal structural stub of the 'claude-code' mods API, used ONLY for
// offline type-checking of this library's pure libs and adapters when the
// real declarations (written by Claude Code into .claude-plugin/types/) are
// not present. NOT a copy of the real API surface: just enough shape for
// `tsc` to check our code. When the real types exist, use `tsc -p mods/<m>`
// instead.

declare module 'claude-code' {
  /** Result of a hook that refuses the call. */
  interface DenyResult {
    deny: string
  }

  /** Anything hook-shaped we return besides next(e). */
  type HookResult = DenyResult | { text: string } | void | undefined

  interface Next {
    (e?: EventInput | Record<string, unknown>): Promise<HookResult> | HookResult
    called?: boolean
  }

  interface SessionUsage {
    context: { tokens: number; window: number }
    rateLimits: Array<{ kind: string; percentUsed: number }>
  }

  interface ModsApi {
    command: {
      register(input: { name: string; description: string }): Promise<void>
    }
    session: {
      usage(): Promise<SessionUsage>
    }
    ui: {
      invalidate(component: string): void
    }
    tool: {
      call(input: { tool: string; [k: string]: unknown }): Promise<unknown>
    }
    /**
     * Ask the host to prompt the human for approval of a held operation.
     * Returns the human's decision, or 'timeout' in non-interactive sessions.
     * Implementations MUST be fail-closed: an unknown/missing answer denies.
     */
    approval: {
      ask(input: {
        command: string
        reason: string
        preview: string
      }): Promise<'approve' | 'deny' | 'timeout'>
    }
  }

  interface EventInput {
    readonly tool?: string
    readonly command?: string
    readonly args?: string
    readonly content?: string
    /** For tool.result: the raw result the tool returned. */
    readonly result?: unknown
    /** For agent.spawn: the subagent role + description. */
    readonly subagentType?: string
    readonly description?: string
    /** For agent.spawn: the model the host intends to use. */
    readonly model?: string
    readonly props?: Record<string, unknown>
    readonly [k: string]: unknown
  }

  type Hook = ($: ModsApi, e: EventInput, next: Next) => Promise<HookResult> | HookResult

  interface Matcher {
    tool?: string
    command?: string
    component?: string
    [k: string]: unknown
  }

  interface On {
    (event: string, hook: Hook): OnReturn
    (event: string, matcher: Matcher, hook: Hook): OnReturn
  }

  interface OnReturn {
    catch(hook: Hook): void
  }

  /** The host API handed to every hook; exported so adapters can name it. */
  type HostApi = ModsApi

  type Register = (on: On) => void
}
